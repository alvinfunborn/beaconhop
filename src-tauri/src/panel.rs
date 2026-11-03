use crate::model::{Bounds, Destination};

// Text inventories keep a readable single column and scroll at the display edge.
// Preview dimensions belong to the native parent and must not size text rows.
pub fn text_size(windows: &[Destination], available: &Bounds, extra: f64) -> (f64, f64) {
    let max_w = (available.width - 64.).max(1.);
    let max_h = (available.height - 96.).max(1.);
    let rows: f64 = windows
        .iter()
        .map(|w| {
            if w.content
                .as_ref()
                .is_some_and(|c| !c.description.is_empty())
            {
                88.
            } else {
                72.
            }
        })
        .sum();
    let content = rows + windows.len().saturating_sub(1) as f64 * 8.;
    (
        760_f64.min(max_w),
        (148. + extra + 28. + content).max(300.).min(max_h),
    )
}

// Size from a preferred thumbnail height, then shrink only to fit the display.
// Search keeps the session's size while filtering, so typing never moves the panel.
pub fn size(windows: &[Destination], available: &Bounds, compact: bool, extra: f64) -> (f64, f64) {
    let max_w = (available.width - 64.).max(1.);
    let max_h = (available.height - 96.).max(1.);
    let min_w = 460_f64.min(max_w);
    let chrome = (148. + extra).min(max_h);
    if windows.is_empty() {
        return (min_w, 300_f64.min(max_h));
    }
    let mut best = (min_w, max_h);
    let mut quality = f64::NEG_INFINITY;
    for columns in 1..=windows.len() {
        let rows = windows.len().div_ceil(columns);
        let gap = 14.;
        let aspect = windows
            .chunks(columns)
            .map(|row| {
                row.iter()
                    .map(|w| {
                        if compact {
                            4.5
                        } else if w.bounds.width > 0. && w.bounds.height > 0. {
                            w.bounds.width / w.bounds.height
                        } else {
                            1.6
                        }
                    })
                    .sum::<f64>()
            })
            .fold(0_f64, f64::max);
        let meta = if compact { 0. } else { 44. };
        let preferred: f64 = if compact { 64. } else { 176. };
        let preview = preferred
            .min((max_w - 28. - gap * (columns - 1) as f64) / aspect)
            .min((max_h - chrome - 28. - gap * (rows - 1) as f64) / rows as f64 - meta)
            .max(0.);
        let width = (aspect * preview + 28. + gap * (columns - 1) as f64).clamp(min_w, max_w);
        let height =
            (chrome + 28. + rows as f64 * (preview + meta) + gap * (rows - 1) as f64).min(max_h);
        let candidate = preview
            - (width * height / (max_w * max_h)) * 5.
            - ((width / height) / 1.7).ln().abs() * 2.;
        if candidate > quality {
            quality = candidate;
            best = (width, height);
        }
    }
    best
}

// Rectangles covering a preview except the badge, shared with native Windows composition.
#[cfg(any(target_os = "windows", test))]
pub fn around_hint(rect: &Bounds, hint: Option<&Bounds>) -> Vec<Bounds> {
    let Some(h) = hint else {
        return vec![rect.clone()];
    };
    let left = h.x.clamp(rect.x, rect.x + rect.width);
    let top = h.y.clamp(rect.y, rect.y + rect.height);
    let right = (h.x + h.width).clamp(left, rect.x + rect.width);
    let bottom = (h.y + h.height).clamp(top, rect.y + rect.height);
    vec![
        Bounds {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: top - rect.y,
        },
        Bounds {
            x: rect.x,
            y: bottom,
            width: rect.width,
            height: rect.y + rect.height - bottom,
        },
        Bounds {
            x: rect.x,
            y: top,
            width: left - rect.x,
            height: bottom - top,
        },
        Bounds {
            x: right,
            y: top,
            width: rect.x + rect.width - right,
            height: bottom - top,
        },
    ]
    .into_iter()
    .filter(|r| r.width > 0. && r.height > 0.)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_inventory_stays_single_column_and_does_not_shrink_large_lists() {
        let display = Bounds {
            width: 1440.,
            height: 900.,
            ..Default::default()
        };
        let windows = vec![Destination::default(); 100];
        let few = text_size(&windows[..2], &display, 0.);
        let many = text_size(&windows, &display, 0.);
        assert_eq!(few, (760., 328.));
        assert_eq!(many, (760., 804.));
        let tiny = text_size(
            &windows,
            &Bounds {
                width: 400.,
                height: 500.,
                ..Default::default()
            },
            72.,
        );
        assert!(tiny.0 <= 336. && tiny.1 <= 404.);
    }
    #[test]
    fn native_preview_leaves_the_hint_visible_without_distorting_the_remaining_image() {
        let rect = Bounds {
            x: 10.,
            y: 20.,
            width: 300.,
            height: 180.,
        };
        let hint = Bounds {
            x: 140.,
            y: 90.,
            width: 40.,
            height: 40.,
        };
        let pieces = around_hint(&rect, Some(&hint));
        assert_eq!(pieces.len(), 4);
        assert_eq!(
            pieces.iter().map(|r| r.width * r.height).sum::<f64>(),
            300. * 180. - 40. * 40.
        );
        for r in pieces {
            assert!(
                r.x + r.width <= hint.x
                    || r.x >= hint.x + hint.width
                    || r.y + r.height <= hint.y
                    || r.y >= hint.y + hint.height
            );
        }
        assert_eq!(around_hint(&rect, None).len(), 1);
    }
    #[test]
    fn few_windows_stay_small_and_large_inventories_fit_each_display() {
        let window = Destination {
            bounds: Bounds {
                width: 1440.,
                height: 900.,
                ..Default::default()
            },
            ..Default::default()
        };
        let display = Bounds {
            width: 1440.,
            height: 900.,
            ..Default::default()
        };
        let small = size(&[window.clone()], &display, false, 0.);
        let many = size(&vec![window.clone(); 24], &display, false, 0.);
        assert!(small.0 < 600. && small.1 < 450.);
        assert!(many.0 * many.1 > small.0 * small.1 * 2.);
        for count in [0, 1, 2, 6, 24, 80] {
            for compact in [false, true] {
                let (w, h) = size(&vec![window.clone(); count], &display, compact, 80.);
                assert!(w > 0. && w <= 1376. && h > 0. && h <= 804.);
            }
        }
    }
}
