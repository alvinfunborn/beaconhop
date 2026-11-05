use std::{
    collections::HashSet,
    sync::{Condvar, Mutex},
    time::Duration,
};

/// Different displays may capture concurrently; overlapping requests share work.
#[derive(Default)]
pub struct CaptureGate {
    pending: Mutex<HashSet<String>>,
    ready: Condvar,
}
pub struct CaptureLease<'a> {
    gate: &'a CaptureGate,
    pub ids: HashSet<String>,
}
impl CaptureGate {
    pub fn claim(&self, ids: impl IntoIterator<Item = String>) -> CaptureLease<'_> {
        let mut pending = self.pending.lock().unwrap();
        let ids = ids
            .into_iter()
            .filter(|id| pending.insert(id.clone()))
            .collect();
        CaptureLease { gate: self, ids }
    }
    pub fn wait(&self, ids: &[String], timeout: Duration) {
        let _ = self
            .ready
            .wait_timeout_while(self.pending.lock().unwrap(), timeout, |pending| {
                ids.iter().any(|id| pending.contains(id))
            })
            .unwrap();
    }
}
impl Drop for CaptureLease<'_> {
    fn drop(&mut self) {
        let mut pending = self.gate.pending.lock().unwrap();
        pending.retain(|id| !self.ids.contains(id));
        self.gate.ready.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{mpsc, Arc},
        thread,
    };
    #[test]
    fn separate_displays_progress_while_overlapping_requests_wait_for_the_owner() {
        let gate = Arc::new(CaptureGate::default());
        let left = gate.claim(["left".into()]);
        let shared = gate.clone();
        let (send, receive) = mpsc::channel();
        let task = thread::spawn(move || {
            let right = shared.claim(["left".into(), "right".into()]);
            assert_eq!(right.ids, HashSet::from(["right".into()]));
            send.send("right finished").unwrap();
            drop(right);
            shared.wait(&["left".into()], Duration::from_secs(2));
            send.send("left finished").unwrap();
        });
        assert_eq!(
            receive.recv_timeout(Duration::from_secs(1)).unwrap(),
            "right finished"
        );
        assert!(receive.try_recv().is_err());
        drop(left);
        assert_eq!(
            receive.recv_timeout(Duration::from_secs(1)).unwrap(),
            "left finished"
        );
        task.join().unwrap();
        assert_eq!(gate.claim(["left".into(), "right".into()]).ids.len(), 2);
    }
}
