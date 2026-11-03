use crate::model::Bounds;

// Follow the displayed rectangles. A shared horizontal/vertical lane wins;
// otherwise use a forward 90-degree cone. No target means the edge is reached.
pub fn neighbor<'a>(
    current: &Bounds,
    candidates: impl Iterator<Item = (&'a str, &'a Bounds)>,
    direction: &str,
) -> Option<String> {
    let vertical = matches!(direction, "ArrowUp" | "ArrowDown");
    let positive = matches!(direction, "ArrowRight" | "ArrowDown");
    let axis = |b: &Bounds| {
        if vertical {
            (b.y, b.height, b.x, b.width)
        } else {
            (b.x, b.width, b.y, b.height)
        }
    };
    let (start, size, cross_start, cross_size) = axis(current);
    candidates
        .filter_map(|(id, b)| {
            let (other, other_size, other_cross, other_cross_size) = axis(b);
            let delta = other + other_size / 2. - start - size / 2.;
            let forward = if positive { delta } else { -delta };
            if forward <= 0.5 {
                return None;
            }
            let cross = (other_cross + other_cross_size / 2. - cross_start - cross_size / 2.).abs();
            let overlap = (cross_start + cross_size).min(other_cross + other_cross_size)
                - cross_start.max(other_cross);
            let lane = overlap > cross_size.min(other_cross_size) * 0.25;
            if !lane && cross > forward {
                return None;
            }
            let gap = if positive {
                other - start - size
            } else {
                start - other - other_size
            }
            .max(0.);
            let score = gap * gap + 2. * cross * cross + forward * forward * 0.01;
            Some((id, !lane, score, forward))
        })
        .min_by(|a, b| {
            a.1.cmp(&b.1)
                .then_with(|| a.2.total_cmp(&b.2))
                .then_with(|| a.3.total_cmp(&b.3))
                .then_with(|| a.0.cmp(b.0))
        })
        .map(|(id, _, _, _)| id.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rect(x: f64, y: f64, w: f64, h: f64) -> Bounds {
        Bounds {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn uneven_rows_use_the_aligned_neighbor_in_all_directions() {
        let a = rect(0., 0., 100., 100.);
        let b = rect(120., 0., 300., 100.);
        let c = rect(150., 120., 100., 100.);
        let d = rect(300., 120., 100., 100.);
        let candidates = || [("a", &a), ("b", &b), ("c", &c), ("d", &d)].into_iter();
        for (from, direction, to) in [
            (&a, "ArrowRight", "b"),
            (&b, "ArrowDown", "c"),
            (&d, "ArrowLeft", "c"),
            (&c, "ArrowUp", "b"),
        ] {
            assert_eq!(neighbor(from, candidates(), direction).as_deref(), Some(to));
        }
        assert_eq!(neighbor(&a, candidates(), "ArrowUp"), None);
        assert_eq!(neighbor(&d, candidates(), "ArrowRight"), None);
    }
    #[test]
    fn slight_vertical_offsets_do_not_steal_up_or_down_from_an_actual_row() {
        let current = rect(200., 200., 200., 160.);
        let sideways = rect(900., 205., 200., 160.);
        let below = rect(220., 400., 200., 160.);
        assert_eq!(
            neighbor(
                &current,
                [("sideways", &sideways), ("below", &below)].into_iter(),
                "ArrowDown"
            )
            .as_deref(),
            Some("below")
        );
        assert_eq!(
            neighbor(&current, [("sideways", &sideways)].into_iter(), "ArrowDown"),
            None
        );
    }
    #[test]
    fn diagonal_fallback_follows_the_requested_direction_and_ties_are_stable() {
        let current = rect(0., 0., 100., 100.);
        let diagonal = rect(160., 130., 100., 100.);
        assert_eq!(
            neighbor(
                &current,
                [("b", &diagonal), ("a", &diagonal)].into_iter(),
                "ArrowRight"
            )
            .as_deref(),
            Some("a")
        );
        assert_eq!(
            neighbor(&current, [("a", &diagonal)].into_iter(), "ArrowUp"),
            None
        );
    }
    #[test]
    fn physical_monitor_positions_allow_negative_coordinates_and_vertical_crossing() {
        let current = rect(200., 100., 200., 100.);
        let upper = rect(180., -600., 200., 100.);
        let right = rect(1600., 110., 200., 100.);
        assert_eq!(
            neighbor(
                &current,
                [("upper", &upper), ("right", &right)].into_iter(),
                "ArrowUp"
            )
            .as_deref(),
            Some("upper")
        );
        assert_eq!(
            neighbor(
                &current,
                [("upper", &upper), ("right", &right)].into_iter(),
                "ArrowRight"
            )
            .as_deref(),
            Some("right")
        );
    }
}
