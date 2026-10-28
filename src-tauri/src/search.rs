use pinyin::ToPinyinMulti;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

fn fold(text: &str) -> String {
    text.nfkd()
        .filter(|c| !is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .collect()
}

pub struct SearchText {
    pub source: String,
    text: String,
    // A pronunciation graph avoids expanding every combination of polyphonic characters.
    syllables: Vec<Vec<String>>,
}
impl SearchText {
    pub fn new(source: String) -> Self {
        let text = fold(&source);
        let syllables = source
            .chars()
            .map(|c| {
                let mut options = vec![fold(&c.to_string())];
                if let Some(readings) = c.to_pinyin_multi() {
                    for reading in readings {
                        let full = fold(reading.plain());
                        options.push(full.replace('v', "u"));
                        options.push(full.clone());
                        if let Some(first) = full.chars().next() {
                            options.push(first.to_string());
                        }
                    }
                }
                options.sort();
                options.dedup();
                options
            })
            .collect();
        Self {
            source,
            text,
            syllables,
        }
    }
    fn phonetic_match(&self, needle: &str) -> bool {
        // Positions in the UTF-8 query reachable at each original character boundary.
        let mut positions = vec![false; needle.len() + 1];
        for options in &self.syllables {
            positions[0] = true;
            let mut next = vec![false; needle.len() + 1];
            for (pos, _) in positions.iter().enumerate().filter(|(_, v)| **v) {
                let rest = &needle[pos..];
                for option in options {
                    if option.starts_with(rest) {
                        return true;
                    }
                    if rest.starts_with(option) {
                        next[pos + option.len()] = true;
                    }
                }
            }
            positions = next;
        }
        false
    }
    pub fn score(&self, query: &str) -> Option<i64> {
        let query = fold(query.trim());
        if query.is_empty() {
            return Some(0);
        }
        let mut score = self
            .text
            .find(&query)
            .map(|i| 10_000 - i as i64)
            .unwrap_or(0);
        for word in query.split_whitespace() {
            if let Some(i) = self.text.find(word) {
                score += 1000 - i as i64;
                continue;
            }
            if word.is_ascii() && self.phonetic_match(word) {
                score += 500;
                continue;
            }
            let mut chars = self.text.char_indices();
            let mut last = 0;
            for c in word.chars() {
                let (i, _) = chars.find(|(_, h)| *h == c)?;
                score += 10 - (i - last) as i64;
                last = i;
            }
        }
        Some(score)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinyin_initials_mixed_text_and_polyphonic_names() {
        let text = SearchText::new("微信 — 产品设计 VSCode".into());
        for query in [
            "weixin",
            "wx",
            "chanpinsheji",
            "cpsj",
            "wei xin",
            "vscode 产品",
            "wx vscode",
            "微信",
        ] {
            assert!(text.score(query).is_some(), "{query}");
        }
        let text = SearchText::new("重庆银行".into());
        for query in ["chongqing", "zhongqing", "yinhang", "yh", "cqyh"] {
            assert!(text.score(query).is_some(), "{query}");
        }
        assert!(text.score("weixin").is_none());
    }
    #[test]
    fn accents_width_and_multiple_query_terms() {
        let text = SearchText::new("Ｃａｆé — Résumé".into());
        assert!(text.score("CAFE resume").is_some());
        assert!(text.score("cafe missing").is_none());
    }
}
