//! Pure text classification and best-effort secret detection. No I/O, fully unit tested.
//!
//! Numbers are only *classified*; the original string is always stored verbatim.

use regex::Regex;
use std::sync::LazyLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classification {
    /// One of: text, url, code, number.
    pub content_type: &'static str,
    /// For numbers: integer, decimal, price, phone, id, reference.
    pub subtype: Option<&'static str>,
}

impl Classification {
    fn of(content_type: &'static str) -> Self {
        Self { content_type, subtype: None }
    }
    fn number(subtype: &'static str) -> Self {
        Self { content_type: "number", subtype: Some(subtype) }
    }
}

static URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(?:(?:https?|ftp|file)://\S+|mailto:\S+|www\.[^\s.]+\.\S+)$").unwrap());
static PRICE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)^[-+]?\s?(?:
            (?:[$€£¥₹]|rs\.?|pkr|usd|eur|gbp)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?
          | (?:[$€£¥₹]|rs\.?|pkr|usd|eur|gbp)\s?\d+(?:\.\d+)?
          | \d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:[$€£¥₹]|rs\.?|pkr|usd|eur|gbp)
          | \d+(?:\.\d+)?\s?(?:[$€£¥₹]|rs\.?|pkr|usd|eur|gbp)
        )$",
    )
    .unwrap()
});
static PHONE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:\+\d[\d\s().-]{6,19}|\(\d{2,4}\)[\s.-]?\d[\d\s.-]{5,14}|\d{2,4}[\s.-]\d{2,4}(?:[\s.-]\d{2,5}){1,2})$").unwrap()
});
static INTEGER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)$").unwrap());
static DECIMAL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d*)\.\d+|\d+\.|\d+(?:\.\d+)?[eE][-+]?\d+)$").unwrap()
});
static REFERENCE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^#?[A-Za-z]{1,8}[-_/#]?\d[\dA-Za-z\-_/]{2,30}$|^#\d{3,}$").unwrap());

/// Classifies clipboard text. Order matters: URL, number, code, then plain text.
pub fn classify_text(text: &str) -> Classification {
    let trimmed = text.trim();
    let single_line = !trimmed.contains('\n') && !trimmed.contains('\r');

    if single_line {
        if URL_RE.is_match(trimmed) {
            return Classification::of("url");
        }
        if let Some(number) = classify_number(trimmed) {
            return number;
        }
    }
    if looks_like_code(trimmed) {
        return Classification::of("code");
    }
    Classification::of("text")
}

fn digit_count(value: &str) -> usize {
    value.chars().filter(char::is_ascii_digit).count()
}

fn classify_number(value: &str) -> Option<Classification> {
    if value.is_empty() || value.len() > 40 || digit_count(value) == 0 {
        return None;
    }
    if PRICE_RE.is_match(value) {
        return Some(Classification::number("price"));
    }
    let digits = digit_count(value);
    let only_digits = value.chars().all(|c| c.is_ascii_digit());

    if PHONE_RE.is_match(value) && (7..=15).contains(&digits) {
        return Some(Classification::number("phone"));
    }
    if only_digits {
        // Leading zero or 10+ digits cannot be a count or a quantity: treat as phone / identifier.
        if (10..=15).contains(&digits) && value.starts_with('0') {
            return Some(Classification::number("phone"));
        }
        if digits >= 10 || (value.len() > 1 && value.starts_with('0')) {
            return Some(Classification::number("id"));
        }
        return Some(Classification::number("integer"));
    }
    if INTEGER_RE.is_match(value) {
        return Some(Classification::number("integer"));
    }
    if DECIMAL_RE.is_match(value) {
        return Some(Classification::number("decimal"));
    }
    if digits >= 3 && REFERENCE_RE.is_match(value) {
        return Some(Classification::number("reference"));
    }
    None
}

fn looks_like_code(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    const STRONG: [&str; 22] = [
        "=> ", "=>{", "();", "){", ") {", "#include", "<?php", "console.log(", "println!(", "fn main",
        "def ", "function ", "import ", "export ", "const ", "let ", "var ", "class ", "public static",
        "</div>", "SELECT ", "#!/",
    ];
    // Unmistakable openers, even on a single line.
    if text.starts_with("#include ") || text.starts_with("#!/") || text.starts_with("<?php") {
        return true;
    }
    let lines: Vec<&str> = text.lines().collect();
    let mut score = 0usize;

    for marker in STRONG {
        if text.contains(marker) {
            score += 1;
        }
    }
    let structural = lines
        .iter()
        .filter(|line| {
            let line = line.trim_end();
            line.ends_with(';') || line.ends_with('{') || line.ends_with('}') || line.ends_with("):") || line.starts_with("    ") || line.starts_with('\t')
        })
        .count();
    if lines.len() > 1 {
        if structural * 3 >= lines.len() {
            score += 2;
        }
        if text.contains("//") || text.contains("/*") || text.contains("</") || text.contains("&&") || text.contains("||") {
            score += 1;
        }
    }
    if text.contains("= (") || text.contains(" == ") || text.contains(" === ") || text.contains("!= ") {
        score += 1;
    }
    if lines.len() == 1 {
        // A single line needs a clear signal, and prose with a stray colon must not qualify.
        score >= 2 || (score == 1 && (text.ends_with(';') || text.ends_with('{') || text.contains("=>")))
    } else {
        score >= 2
    }
}

// ---------------------------------------------------------------------------------------------
// Best-effort secret detection. This is a heuristic, not a guarantee.
// ---------------------------------------------------------------------------------------------

static SECRET_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----",
        r"\bAKIA[0-9A-Z]{16}\b",
        r"\bgh[pousr]_[A-Za-z0-9]{30,}\b",
        r"\bgithub_pat_[A-Za-z0-9_]{40,}\b",
        r"\bsk-[A-Za-z0-9_-]{20,}\b",
        r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b",
        r"\bAIza[0-9A-Za-z_-]{35}\b",
        r"\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
        r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{20,}",
        r"(?i)\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*\S{4,}",
        r"(?i)[?&](?:token|access_token|api_key|apikey|key|password|secret|sig|signature)=[^&\s]{8,}",
        r"(?i)\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@",
    ]
    .iter()
    .map(|pattern| Regex::new(pattern).unwrap())
    .collect()
});

fn shannon_entropy(value: &str) -> f64 {
    let mut counts = std::collections::HashMap::new();
    let mut total = 0f64;
    for c in value.chars() {
        *counts.entry(c).or_insert(0f64) += 1.0;
        total += 1.0;
    }
    counts.values().map(|n| -(n / total) * (n / total).log2()).sum()
}

/// True when the text looks like a credential: a known token format, a `password=` assignment,
/// a private key, or a single opaque high-entropy / password-like word.
pub fn looks_sensitive(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 20_000 {
        return false;
    }
    if SECRET_PATTERNS.iter().any(|pattern| pattern.is_match(trimmed)) {
        return true;
    }
    // Single opaque token: no whitespace, mixed character classes, not a URL or a path.
    if trimmed.chars().any(char::is_whitespace) || URL_RE.is_match(trimmed) || trimmed.contains('\\') || trimmed.contains("://") {
        return false;
    }
    let len = trimmed.chars().count();
    let (mut lower, mut upper, mut digit, mut symbol) = (false, false, false, false);
    for c in trimmed.chars() {
        if c.is_ascii_lowercase() {
            lower = true;
        } else if c.is_ascii_uppercase() {
            upper = true;
        } else if c.is_ascii_digit() {
            digit = true;
        } else {
            symbol = true;
        }
    }
    let classes = [lower, upper, digit, symbol].iter().filter(|present| **present).count();
    if (24..=256).contains(&len) && classes >= 3 && shannon_entropy(trimmed) > 3.6 {
        return true;
    }
    // Password-like: short, all four classes (a lone "Word1!" style string).
    (8..=40).contains(&len) && lower && upper && digit && symbol
}

// ---------------------------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------------------------

/// A single-line, whitespace-collapsed preview capped at `max_chars` characters.
pub fn make_preview(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    let mut pending_space = false;
    for c in text.chars() {
        if c.is_whitespace() {
            pending_space = !out.is_empty();
            continue;
        }
        if pending_space {
            out.push(' ');
            count += 1;
            pending_space = false;
        }
        if count >= max_chars {
            out.push('…');
            break;
        }
        out.push(c);
        count += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(text: &str) -> (&'static str, Option<&'static str>) {
        let c = classify_text(text);
        (c.content_type, c.subtype)
    }

    #[test]
    fn plain_text_and_empty_like() {
        assert_eq!(kind("Hello world, this is a note about lunch."), ("text", None));
        assert_eq!(kind("Meeting at 5pm: bring the slides"), ("text", None));
        assert_eq!(kind("12 Baker Street, London"), ("text", None));
        assert_eq!(kind("Unicode: héllo wörld ✓ 日本語"), ("text", None));
    }

    #[test]
    fn urls() {
        assert_eq!(kind("https://example.com/path?a=1#x"), ("url", None));
        assert_eq!(kind("http://localhost:1420"), ("url", None));
        assert_eq!(kind("www.example.com/page"), ("url", None));
        assert_eq!(kind("mailto:someone@example.com"), ("url", None));
        assert_eq!(kind("see https://example.com for more"), ("text", None));
    }

    #[test]
    fn integers_and_decimals() {
        assert_eq!(kind("42"), ("number", Some("integer")));
        assert_eq!(kind("-17"), ("number", Some("integer")));
        assert_eq!(kind("1,234,567"), ("number", Some("integer")));
        assert_eq!(kind("3.14159"), ("number", Some("decimal")));
        assert_eq!(kind("-0.5"), ("number", Some("decimal")));
        assert_eq!(kind(".75"), ("number", Some("decimal")));
        assert_eq!(kind("1.5e10"), ("number", Some("decimal")));
        assert_eq!(kind("1,234.56"), ("number", Some("decimal")));
    }

    #[test]
    fn prices() {
        assert_eq!(kind("$19.99"), ("number", Some("price")));
        assert_eq!(kind("€ 1,299.00"), ("number", Some("price")));
        assert_eq!(kind("Rs. 2500"), ("number", Some("price")));
        assert_eq!(kind("49.90 USD"), ("number", Some("price")));
        assert_eq!(kind("£5"), ("number", Some("price")));
    }

    #[test]
    fn phones_ids_references() {
        assert_eq!(kind("+92 300 1234567"), ("number", Some("phone")));
        assert_eq!(kind("+1 (555) 123-4567"), ("number", Some("phone")));
        assert_eq!(kind("(555) 123-4567"), ("number", Some("phone")));
        assert_eq!(kind("555-123-4567"), ("number", Some("phone")));
        assert_eq!(kind("03001234567"), ("number", Some("phone")));
        assert_eq!(kind("4111111111111111"), ("number", Some("id")));
        assert_eq!(kind("007"), ("number", Some("id")));
        assert_eq!(kind("INV-2024-0042"), ("number", Some("reference")));
        assert_eq!(kind("#12345"), ("number", Some("reference")));
        assert_eq!(kind("ABC123456"), ("number", Some("reference")));
    }

    #[test]
    fn numbers_keep_exact_original_string() {
        // Classification never rewrites input; callers store the raw string.
        let original = "007.50";
        let _ = classify_text(original);
        assert_eq!(original, "007.50");
        assert_eq!(kind("1,000"), ("number", Some("integer")));
    }

    #[test]
    fn code() {
        assert_eq!(kind("const x = 42;\nfunction add(a, b) {\n  return a + b;\n}").0, "code");
        assert_eq!(kind("fn main() {\n    println!(\"hi\");\n}").0, "code");
        assert_eq!(kind("def hello():\n    return 1").0, "code");
        assert_eq!(kind("#include <stdio.h>").0, "code");
        assert_eq!(kind("items.map(x => x * 2);").0, "code");
        assert_eq!(kind("SELECT * FROM notes WHERE id = 1;").0, "code");
        assert_eq!(kind("I wrote some thoughts: they were nice").0, "text");
    }

    #[test]
    fn secrets_known_formats() {
        assert!(looks_sensitive("AKIAIOSFODNN7EXAMPLE"));
        assert!(looks_sensitive("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(looks_sensitive("sk-abcdefghijklmnopqrstuvwxyz123456"));
        assert!(looks_sensitive("-----BEGIN RSA PRIVATE KEY-----\nMIIE..."));
        assert!(looks_sensitive("password = hunter2222"));
        assert!(looks_sensitive("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123"));
        assert!(looks_sensitive("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"));
        assert!(looks_sensitive("https://host/api?access_token=abcdef123456"));
        assert!(looks_sensitive("postgres://user:pw12345@db.local/app"));
    }

    #[test]
    fn secrets_password_like_and_negatives() {
        assert!(looks_sensitive("P@ssw0rd!2024"));
        assert!(!looks_sensitive("Hello, this is a normal sentence."));
        assert!(!looks_sensitive("https://example.com/docs/page"));
        assert!(!looks_sensitive("3.14159"));
        assert!(!looks_sensitive("C:\\Users\\me\\Documents\\Report 2024.docx"));
        assert!(!looks_sensitive("lunch at noon"));
        assert!(!looks_sensitive(""));
    }

    #[test]
    fn previews() {
        assert_eq!(make_preview("  hello \n\n  world  ", 50), "hello world");
        let long = "a".repeat(500);
        let p = make_preview(&long, 300);
        assert_eq!(p.chars().count(), 301);
        assert!(p.ends_with('…'));
    }
}
