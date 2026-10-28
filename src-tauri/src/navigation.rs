use crate::model::Bounds;
// Prefer the next visual row and its closest horizontal center for Up/Down.
// Horizontal arrows stay in a row; the caller handles edge wrapping like Tab.
pub fn neighbor<'a>(
    current: &Bounds,
    candidates: impl Iterator<Item = (&'a str, &'a Bounds)>,
    direction: &str,
) -> Option<String> {
    let vertical = matches!(direction, "ArrowUp" | "ArrowDown");
    let positive = matches!(direction, "ArrowRight" | "ArrowDown");
    let (x, y) = (
        current.x + current.width / 2.,
        current.y + current.height / 2.,
    );
    candidates
        .filter_map(|(id, b)| {
            let dx = b.x + b.width / 2. - x;
            let dy = b.y + b.height / 2. - y;
            let (primary, cross) = if vertical {
                (dy, dx.abs())
            } else {
                (dx, dy.abs())
            };
            if (positive && primary <= 0.5)
                || (!positive && primary >= -0.5)
                || (!vertical && cross > current.height.max(b.height) / 2.)
            {
                return None;
            }
            Some((id, primary.abs(), cross))
        })
        .min_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.2.total_cmp(&b.2)))
        .map(|(id, _, _)| id.into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spatial_navigation_uses_rows_and_centers_in_uneven_grids() {
        let a = Bounds {
            x: 0.,
            y: 0.,
            width: 100.,
            height: 100.,
        };
        let b = Bounds {
            x: 120.,
            y: 0.,
            width: 300.,
            height: 100.,
        };
        let c = Bounds {
            x: 150.,
            y: 120.,
            width: 100.,
            height: 100.,
        };
        let d = Bounds {
            x: 300.,
            y: 120.,
            width: 100.,
            height: 100.,
        };
        let candidates = || [("a", &a), ("b", &b), ("c", &c), ("d", &d)].into_iter();
        assert_eq!(
            neighbor(&a, candidates(), "ArrowRight").as_deref(),
            Some("b")
        );
        assert_eq!(
            neighbor(&b, candidates(), "ArrowDown").as_deref(),
            Some("c")
        );
        assert_eq!(
            neighbor(&d, candidates(), "ArrowLeft").as_deref(),
            Some("c")
        );
        assert_eq!(neighbor(&c, candidates(), "ArrowUp").as_deref(), Some("b"));
    }
}
