//! Reading and writing Windows clipboard formats.
//!
//! The pure parsers/encoders (CF_HTML, CF_HDROP, DIB, PNG/JPEG) are platform independent and unit
//! tested. Only the `read_current` / `write_payload` functions touch the real clipboard.

use super::store::CopyPayload;
use image::{ImageFormat, ImageReader, RgbaImage};
use std::io::Cursor;

// ---- Limits (protect memory and disk) ------------------------------------------------------
pub const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_RICH_BYTES: usize = 512 * 1024;
pub const MAX_IMAGE_DIMENSION: u32 = 8192;
pub const MAX_IMAGE_PIXELS: u64 = 20_000_000;
pub const MAX_RAW_IMAGE_BYTES: usize = 96 * 1024 * 1024;
pub const MAX_PNG_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_FILES: usize = 2000;
pub const THUMB_SIZE: u32 = 192;

/// Why an image could not be captured. Never carries image content.
#[derive(Debug, PartialEq, Eq)]
pub enum ImageError {
    TooLarge,
    Unsupported,
}

pub struct DecodedImage {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Clipboard representation the pixels came from: PNG, JPEG, CF_DIBV5 or CF_DIB.
    pub source: &'static str,
    pub source_mime: &'static str,
}

pub enum Captured {
    Text { text: String, html: Option<String>, rtf: Option<String> },
    Image(DecodedImage),
    Files(Vec<String>),
}

pub enum ReadOutcome {
    Captured(Captured),
    /// The source asked not to be recorded (password managers etc.).
    Excluded,
    /// Nothing we capture (or whitespace-only text).
    Empty,
    /// The clipboard stayed locked by another process.
    Busy,
    TooLarge,
    Unsupported,
}

// ============================================================================================
// Pure helpers
// ============================================================================================

pub fn parse_unicode_text(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

pub fn encode_unicode_text(text: &str) -> Vec<u8> {
    text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect()
}

fn header_value(header: &str, key: &str) -> Option<usize> {
    header.lines().find_map(|line| line.strip_prefix(key)).and_then(|v| v.trim().parse().ok())
}

/// Extracts the HTML fragment from a CF_HTML ("HTML Format") payload.
pub fn parse_cf_html(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    let bytes = &bytes[..end];
    let head_len = bytes.len().min(400);
    let header = String::from_utf8_lossy(&bytes[..head_len]);
    if let (Some(start), Some(stop)) = (header_value(&header, "StartFragment:"), header_value(&header, "EndFragment:")) {
        if start < stop && stop <= bytes.len() {
            return Some(String::from_utf8_lossy(&bytes[start..stop]).into_owned());
        }
    }
    let all = String::from_utf8_lossy(bytes);
    if let (Some(start), Some(stop)) = (all.find("<!--StartFragment-->"), all.find("<!--EndFragment-->")) {
        let from = start + "<!--StartFragment-->".len();
        if from <= stop {
            return Some(all[from..stop].to_string());
        }
    }
    // Some sources put bare HTML on the clipboard without the CF_HTML envelope.
    all.contains('<').then(|| all.into_owned())
}

/// Wraps an HTML fragment in a valid CF_HTML envelope with correct byte offsets.
pub fn build_cf_html(fragment: &str) -> Vec<u8> {
    let prefix = "<html><body>\r\n<!--StartFragment-->";
    let suffix = "<!--EndFragment-->\r\n</body></html>";
    // Header fields are fixed-width (10 digits), so its length is known up front.
    let template = |a: usize, b: usize, c: usize, d: usize| {
        format!("Version:0.9\r\nStartHTML:{a:010}\r\nEndHTML:{b:010}\r\nStartFragment:{c:010}\r\nEndFragment:{d:010}\r\n")
    };
    let header_len = template(0, 0, 0, 0).len();
    let start_html = header_len;
    let start_fragment = start_html + prefix.len();
    let end_fragment = start_fragment + fragment.len();
    let end_html = end_fragment + suffix.len();
    let mut out = template(start_html, end_html, start_fragment, end_fragment).into_bytes();
    out.extend_from_slice(prefix.as_bytes());
    out.extend_from_slice(fragment.as_bytes());
    out.extend_from_slice(suffix.as_bytes());
    out.push(0);
    out
}

/// Parses a DROPFILES structure into file paths.
pub fn parse_hdrop(bytes: &[u8]) -> Vec<String> {
    if bytes.len() < 20 {
        return Vec::new();
    }
    let offset = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let wide = u32::from_le_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]) != 0;
    if offset < 20 || offset > bytes.len() {
        return Vec::new();
    }
    let body = &bytes[offset..];
    let mut paths = Vec::new();
    if wide {
        let units: Vec<u16> = body.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
        for part in units.split(|u| *u == 0) {
            if part.is_empty() {
                break; // double NUL terminates the list
            }
            paths.push(String::from_utf16_lossy(part));
            if paths.len() >= MAX_FILES {
                break;
            }
        }
    } else {
        for part in body.split(|b| *b == 0) {
            if part.is_empty() {
                break;
            }
            paths.push(String::from_utf8_lossy(part).into_owned());
            if paths.len() >= MAX_FILES {
                break;
            }
        }
    }
    paths
}

pub fn build_hdrop(paths: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&20u32.to_le_bytes()); // pFiles
    out.extend_from_slice(&[0u8; 12]); // pt.x, pt.y, fNC
    out.extend_from_slice(&1u32.to_le_bytes()); // fWide
    for path in paths {
        for unit in path.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(&[0, 0]);
    out
}

fn check_dimensions(width: u64, height: u64) -> Result<(), ImageError> {
    if width == 0 || height == 0 {
        return Err(ImageError::Unsupported);
    }
    if width > MAX_IMAGE_DIMENSION as u64 || height > MAX_IMAGE_DIMENSION as u64 || width * height > MAX_IMAGE_PIXELS {
        return Err(ImageError::TooLarge);
    }
    Ok(())
}

/// Decodes PNG or JPEG bytes after checking dimensions from the header alone.
pub fn decode_encoded(bytes: &[u8], format: ImageFormat) -> Result<(u32, u32, Vec<u8>), ImageError> {
    let (w, h) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| ImageError::Unsupported)?;
    check_dimensions(w as u64, h as u64)?;
    let image = ImageReader::with_format(Cursor::new(bytes), format)
        .decode()
        .map_err(|_| ImageError::Unsupported)?
        .into_rgba8();
    Ok((image.width(), image.height(), image.into_raw()))
}

pub fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Option<Vec<u8>> {
    let image = RgbaImage::from_raw(width, height, rgba)?;
    let mut out = Vec::new();
    image.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).ok()?;
    Some(out)
}

/// A PNG thumbnail whose longest side is at most `THUMB_SIZE`.
pub fn make_thumbnail(rgba: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let image = RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let scale = (THUMB_SIZE as f32 / width.max(height) as f32).min(1.0);
    let (tw, th) = (((width as f32 * scale).round() as u32).max(1), ((height as f32 * scale).round() as u32).max(1));
    let thumb = if scale < 1.0 { image::imageops::resize(&image, tw, th, image::imageops::FilterType::Triangle) } else { image };
    encode_png(thumb.into_raw(), tw, th)
}

fn channel(value: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let shift = mask.trailing_zeros();
    let max = (mask >> shift) as u64;
    ((((value & mask) >> shift) as u64) * 255 / max) as u8
}

fn u32_at(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

/// Decodes a packed DIB (CF_DIB / CF_DIBV5) into RGBA. Supports 1/4/8-bit palettes and
/// 16/24/32-bit BI_RGB or BI_BITFIELDS. RLE and JPEG/PNG-compressed DIBs are reported unsupported.
pub fn decode_dib(data: &[u8]) -> Result<(u32, u32, Vec<u8>), ImageError> {
    if data.len() < 40 {
        return Err(ImageError::Unsupported);
    }
    let header_size = u32_at(data, 0) as usize;
    if header_size < 40 || header_size > data.len() {
        return Err(ImageError::Unsupported);
    }
    let width = u32_at(data, 4) as i32;
    let raw_height = u32_at(data, 8) as i32;
    let bpp = u16::from_le_bytes([data[14], data[15]]) as usize;
    let compression = u32_at(data, 16);
    let colors_used = u32_at(data, 32) as usize;
    if width <= 0 || raw_height == 0 || !matches!(compression, 0 | 3) || !matches!(bpp, 1 | 4 | 8 | 16 | 24 | 32) {
        return Err(ImageError::Unsupported);
    }
    let top_down = raw_height < 0;
    let (w, h) = (width as u32, raw_height.unsigned_abs());
    check_dimensions(w as u64, h as u64)?;

    // Channel masks.
    let (mut red, mut green, mut blue, mut alpha) = match bpp {
        16 => (0x7C00u32, 0x03E0, 0x001F, 0),
        _ => (0x00FF_0000u32, 0x0000_FF00, 0x0000_00FF, 0xFF00_0000),
    };
    let mut pixel_offset = header_size;
    if compression == 3 {
        if header_size == 40 {
            if data.len() < 52 {
                return Err(ImageError::Unsupported);
            }
            (red, green, blue, alpha) = (u32_at(data, 40), u32_at(data, 44), u32_at(data, 48), 0);
            pixel_offset = 52;
        } else if header_size >= 52 {
            (red, green, blue) = (u32_at(data, 40), u32_at(data, 44), u32_at(data, 48));
            alpha = if header_size >= 56 { u32_at(data, 52) } else { 0 };
        }
    } else if bpp != 32 && header_size >= 56 {
        alpha = 0;
    }

    let mut palette: Vec<[u8; 3]> = Vec::new();
    if bpp <= 8 {
        let entries = if colors_used > 0 { colors_used.min(1 << bpp) } else { 1 << bpp };
        if data.len() < pixel_offset + entries * 4 {
            return Err(ImageError::Unsupported);
        }
        for i in 0..entries {
            let at = pixel_offset + i * 4;
            palette.push([data[at + 2], data[at + 1], data[at]]);
        }
        pixel_offset += entries * 4;
    } else if colors_used > 0 {
        pixel_offset += colors_used * 4;
    }

    let stride = ((w as usize * bpp + 31) / 32) * 4;
    if (data.len() as u64) < pixel_offset as u64 + stride as u64 * h as u64 {
        return Err(ImageError::Unsupported);
    }

    let mut rgba = vec![0u8; w as usize * h as usize * 4];
    let mut any_alpha = false;
    for y in 0..h as usize {
        let source_row = if top_down { y } else { h as usize - 1 - y };
        let row = &data[pixel_offset + source_row * stride..][..stride];
        for x in 0..w as usize {
            let out = (y * w as usize + x) * 4;
            let (r, g, b, a) = match bpp {
                1 | 4 | 8 => {
                    let index = match bpp {
                        8 => row[x] as usize,
                        4 => ((row[x / 2] >> (if x % 2 == 0 { 4 } else { 0 })) & 0x0F) as usize,
                        _ => ((row[x / 8] >> (7 - x % 8)) & 1) as usize,
                    };
                    let [r, g, b] = palette.get(index).copied().unwrap_or([0, 0, 0]);
                    (r, g, b, 255)
                }
                16 => {
                    let v = u16::from_le_bytes([row[x * 2], row[x * 2 + 1]]) as u32;
                    (channel(v, red), channel(v, green), channel(v, blue), 255)
                }
                24 => (row[x * 3 + 2], row[x * 3 + 1], row[x * 3], 255),
                _ => {
                    let v = u32_at(row, x * 4);
                    let a = if alpha == 0 { 255 } else { channel(v, alpha) };
                    (channel(v, red), channel(v, green), channel(v, blue), a)
                }
            };
            any_alpha |= a != 0;
            rgba[out..out + 4].copy_from_slice(&[r, g, b, a]);
        }
    }
    // A 32-bit DIB whose alpha channel is entirely zero means "alpha unused", not "invisible".
    if !any_alpha {
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
    }
    Ok((w, h, rgba))
}

/// Encodes RGBA as a bottom-up 32-bit BI_RGB DIB, composited over white so consumers that ignore
/// alpha (Paint, Word) show the picture rather than black. Alpha-aware apps get the PNG format.
pub fn encode_dib(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(40 + rgba.len());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(width as i32).to_le_bytes());
    out.extend_from_slice(&(height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&((width as usize * height as usize * 4) as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 16]);
    for y in (0..height as usize).rev() {
        for x in 0..width as usize {
            let p = &rgba[(y * width as usize + x) * 4..][..4];
            let a = p[3] as u32;
            let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
            out.extend_from_slice(&[blend(p[2]), blend(p[1]), blend(p[0]), 255]);
        }
    }
    out
}

// ============================================================================================
// Windows clipboard access
// ============================================================================================

#[cfg(windows)]
mod win {
    use super::*;
    use std::{ptr, thread, time::Duration};
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HANDLE},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
                OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        },
    };

    const CF_UNICODETEXT: u32 = 13;
    const CF_DIB: u32 = 8;
    const CF_DIBV5: u32 = 17;
    const CF_HDROP: u32 = 15;

    fn wide(name: &str) -> Vec<u16> {
        name.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn registered(name: &str) -> u32 {
        // SAFETY: `wide` yields a NUL-terminated UTF-16 string that outlives the call.
        unsafe { RegisterClipboardFormatW(wide(name).as_ptr()) }
    }

    fn available(format: u32) -> bool {
        // SAFETY: plain query with no pointers.
        format != 0 && unsafe { IsClipboardFormatAvailable(format) } != 0
    }

    pub fn sequence_number() -> u32 {
        // SAFETY: no arguments.
        unsafe { GetClipboardSequenceNumber() }
    }

    /// RAII guard so every exit path closes the clipboard.
    struct Open;
    impl Open {
        fn acquire() -> Option<Open> {
            for _ in 0..15 {
                // SAFETY: a null owner window associates the clipboard with the current task.
                if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
                    return Some(Open);
                }
                thread::sleep(Duration::from_millis(20));
            }
            None
        }
    }
    impl Drop for Open {
        fn drop(&mut self) {
            // SAFETY: only constructed after a successful OpenClipboard on this thread.
            unsafe { CloseClipboard() };
        }
    }

    enum Raw {
        Missing,
        TooLarge,
        Bytes(Vec<u8>),
    }

    /// Must be called while the clipboard is open.
    fn read_raw(format: u32, limit: usize) -> Raw {
        if !available(format) {
            return Raw::Missing;
        }
        // SAFETY: the clipboard is open; the returned handle is owned by the clipboard and only
        // locked for the duration of the copy below.
        unsafe {
            let handle: HANDLE = GetClipboardData(format);
            if handle.is_null() {
                return Raw::Missing;
            }
            let size = GlobalSize(handle);
            if size == 0 {
                return Raw::Missing;
            }
            if size > limit {
                return Raw::TooLarge;
            }
            let data = GlobalLock(handle);
            if data.is_null() {
                return Raw::Missing;
            }
            let bytes = std::slice::from_raw_parts(data as *const u8, size).to_vec();
            GlobalUnlock(handle);
            Raw::Bytes(bytes)
        }
    }

    fn excluded() -> bool {
        if available(registered("ExcludeClipboardContentFromMonitorProcessing")) {
            return true;
        }
        let include = registered("CanIncludeInClipboardHistory");
        if let Raw::Bytes(bytes) = read_raw(include, 16) {
            if bytes.len() >= 4 && u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == 0 {
                return true;
            }
        }
        false
    }

    enum Gathered {
        Files(Vec<u8>),
        Text { text: Vec<u8>, html: Option<Vec<u8>>, rtf: Option<Vec<u8>>, image: Option<(ImageKind, Vec<u8>)> },
        Image(ImageKind, Vec<u8>),
    }

    #[derive(Clone, Copy)]
    enum ImageKind {
        Png,
        Jpeg,
        DibV5,
        Dib,
    }

    fn gather_image() -> Result<Option<(ImageKind, Vec<u8>)>, ()> {
        let candidates = [
            (ImageKind::Png, registered("PNG")),
            (ImageKind::Png, registered("image/png")),
            (ImageKind::Jpeg, registered("JFIF")),
            (ImageKind::DibV5, CF_DIBV5),
            (ImageKind::Dib, CF_DIB),
        ];
        for (kind, format) in candidates {
            match read_raw(format, MAX_RAW_IMAGE_BYTES) {
                Raw::Bytes(bytes) => return Ok(Some((kind, bytes))),
                Raw::TooLarge => return Err(()),
                Raw::Missing => {}
            }
        }
        Ok(None)
    }

    fn decode_image(kind: ImageKind, bytes: &[u8]) -> Result<DecodedImage, ImageError> {
        let (source, source_mime, decoded) = match kind {
            ImageKind::Png => ("PNG", "image/png", decode_encoded(bytes, ImageFormat::Png)?),
            ImageKind::Jpeg => ("JPEG", "image/jpeg", decode_encoded(bytes, ImageFormat::Jpeg)?),
            ImageKind::DibV5 => ("CF_DIBV5", "image/bmp", decode_dib(bytes)?),
            ImageKind::Dib => ("CF_DIB", "image/bmp", decode_dib(bytes)?),
        };
        Ok(DecodedImage { rgba: decoded.2, width: decoded.0, height: decoded.1, source, source_mime })
    }

    pub fn read_current() -> ReadOutcome {
        let html_format = registered("HTML Format");
        let rtf_format = registered("Rich Text Format");

        let gathered = {
            let Some(_open) = Open::acquire() else {
                return ReadOutcome::Busy;
            };
            if excluded() {
                return ReadOutcome::Excluded;
            }
            if available(CF_HDROP) {
                match read_raw(CF_HDROP, 4 * 1024 * 1024) {
                    Raw::Bytes(bytes) => Gathered::Files(bytes),
                    Raw::TooLarge => return ReadOutcome::TooLarge,
                    Raw::Missing => return ReadOutcome::Unsupported,
                }
            } else if available(CF_UNICODETEXT) {
                let text = match read_raw(CF_UNICODETEXT, MAX_TEXT_BYTES * 2 + 2) {
                    Raw::Bytes(bytes) => bytes,
                    Raw::TooLarge => return ReadOutcome::TooLarge,
                    Raw::Missing => return ReadOutcome::Empty,
                };
                let keep = |raw: Raw| match raw {
                    Raw::Bytes(bytes) if bytes.len() <= MAX_RICH_BYTES => Some(bytes),
                    _ => None,
                };
                let html = keep(read_raw(html_format, MAX_RICH_BYTES * 2));
                let rtf = keep(read_raw(rtf_format, MAX_RICH_BYTES * 2));
                // If the text is blank (e.g. image copied from a page), also keep the picture.
                let blank = parse_unicode_text(&text).trim().is_empty();
                let image = if blank { gather_image().ok().flatten() } else { None };
                Gathered::Text { text, html, rtf, image }
            } else {
                match gather_image() {
                    Ok(Some((kind, bytes))) => Gathered::Image(kind, bytes),
                    Ok(None) => return ReadOutcome::Empty,
                    Err(()) => return ReadOutcome::TooLarge,
                }
            }
        };

        // Clipboard is closed again: decode and parse without holding it.
        match gathered {
            Gathered::Files(bytes) => {
                let paths = parse_hdrop(&bytes);
                if paths.is_empty() {
                    ReadOutcome::Unsupported
                } else {
                    ReadOutcome::Captured(Captured::Files(paths))
                }
            }
            Gathered::Image(kind, bytes) => match decode_image(kind, &bytes) {
                Ok(image) => ReadOutcome::Captured(Captured::Image(image)),
                Err(ImageError::TooLarge) => ReadOutcome::TooLarge,
                Err(ImageError::Unsupported) => ReadOutcome::Unsupported,
            },
            Gathered::Text { text, html, rtf, image } => {
                let text = parse_unicode_text(&text);
                if text.trim().is_empty() {
                    return match image {
                        Some((kind, bytes)) => match decode_image(kind, &bytes) {
                            Ok(image) => ReadOutcome::Captured(Captured::Image(image)),
                            Err(ImageError::TooLarge) => ReadOutcome::TooLarge,
                            Err(ImageError::Unsupported) => ReadOutcome::Empty,
                        },
                        None => ReadOutcome::Empty,
                    };
                }
                ReadOutcome::Captured(Captured::Text {
                    text,
                    html: html.and_then(|raw| parse_cf_html(&raw)).filter(|h| !h.trim().is_empty()),
                    rtf: rtf.map(|raw| String::from_utf8_lossy(&raw).trim_end_matches('\0').to_string()).filter(|r| !r.trim().is_empty()),
                })
            }
        }
    }

    /// Allocates a movable global block holding `bytes` and hands it to the clipboard.
    fn set_data(format: u32, bytes: &[u8]) -> bool {
        // SAFETY: the clipboard is open. On success the system owns the block; on failure we free it.
        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
            if handle.is_null() {
                return false;
            }
            let target = GlobalLock(handle);
            if target.is_null() {
                GlobalFree(handle);
                return false;
            }
            ptr::copy_nonoverlapping(bytes.as_ptr(), target as *mut u8, bytes.len());
            GlobalUnlock(handle);
            if SetClipboardData(format, handle).is_null() {
                GlobalFree(handle);
                return false;
            }
            true
        }
    }

    /// Puts a stored item back on the clipboard. Returns the clipboard sequence number after the
    /// write so the listener can recognise (and ignore) the notification this causes.
    pub fn write_payload(payload: &CopyPayload) -> Result<u32, String> {
        // Prepare every format before opening the clipboard to keep it locked as briefly as possible.
        let mut formats: Vec<(u32, Vec<u8>)> = Vec::new();
        match payload.content_type.as_str() {
            "image" => {
                let png = payload.png.as_ref().ok_or("The saved image is missing")?;
                let (w, h, rgba) = decode_encoded(png, ImageFormat::Png).map_err(|_| "The saved image could not be read")?;
                formats.push((CF_DIB, encode_dib(&rgba, w, h)));
                formats.push((registered("PNG"), png.clone()));
            }
            "file" => {
                if payload.files.is_empty() {
                    return Err("No file paths were saved for this item".into());
                }
                formats.push((CF_HDROP, build_hdrop(&payload.files)));
            }
            _ => {
                let text = payload.text.as_deref().unwrap_or_default();
                formats.push((CF_UNICODETEXT, encode_unicode_text(text)));
                if let Some(html) = &payload.html {
                    formats.push((registered("HTML Format"), build_cf_html(html)));
                }
                if let Some(rtf) = &payload.rtf {
                    let mut bytes = rtf.clone().into_bytes();
                    bytes.push(0);
                    formats.push((registered("Rich Text Format"), bytes));
                }
            }
        }

        let _open = Open::acquire().ok_or("The clipboard is busy. Try again in a moment.")?;
        // SAFETY: the clipboard is open on this thread.
        if unsafe { EmptyClipboard() } == 0 {
            return Err("Could not clear the clipboard".into());
        }
        let mut wrote_any = false;
        for (format, bytes) in &formats {
            wrote_any |= set_data(*format, bytes);
        }
        if !wrote_any {
            return Err("Could not write to the clipboard".into());
        }
        drop(_open);
        Ok(sequence_number())
    }
}

#[cfg(windows)]
pub use win::{read_current, sequence_number, write_payload};

#[cfg(not(windows))]
pub fn read_current() -> ReadOutcome {
    ReadOutcome::Unsupported
}
#[cfg(not(windows))]
pub fn sequence_number() -> u32 {
    0
}
#[cfg(not(windows))]
pub fn write_payload(_payload: &CopyPayload) -> Result<u32, String> {
    Err("Clipboard access is only available on Windows".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_text_round_trip() {
        let text = "Héllo ✓ 日本語 😀 007.50";
        assert_eq!(parse_unicode_text(&encode_unicode_text(text)), text);
        // Trailing garbage after the NUL is ignored.
        let mut bytes = encode_unicode_text("abc");
        bytes.extend_from_slice(&[0x41, 0, 0x42, 0]);
        assert_eq!(parse_unicode_text(&bytes), "abc");
    }

    #[test]
    fn cf_html_round_trip() {
        let fragment = "<b>bold</b> & <i>ünï</i>";
        let built = build_cf_html(fragment);
        assert_eq!(parse_cf_html(&built).as_deref(), Some(fragment));
    }

    #[test]
    fn cf_html_header_offsets_are_exact() {
        let built = build_cf_html("<p>x</p>");
        let text = String::from_utf8_lossy(&built).to_string();
        let start = header_value(&text, "StartHTML:").unwrap();
        let end = header_value(&text, "EndHTML:").unwrap();
        assert!(text[start..].starts_with("<html>"));
        assert_eq!(end, built.len() - 1, "EndHTML excludes the trailing NUL");
    }

    #[test]
    fn cf_html_without_offsets_uses_markers() {
        let raw = b"Version:0.9\r\n<html><!--StartFragment--><u>hi</u><!--EndFragment--></html>";
        assert_eq!(parse_cf_html(raw).as_deref(), Some("<u>hi</u>"));
        assert_eq!(parse_cf_html(b"garbage"), None);
    }

    #[test]
    fn hdrop_round_trip_multiple_paths() {
        let paths = vec!["C:\\Users\\me\\Doc 1.txt".to_string(), "D:\\ünï\\photo.png".to_string(), "C:\\a".to_string()];
        assert_eq!(parse_hdrop(&build_hdrop(&paths)), paths);
        assert!(parse_hdrop(&[1, 2, 3]).is_empty());
        assert!(parse_hdrop(&build_hdrop(&[])).is_empty());
    }

    #[test]
    fn hdrop_ansi_variant() {
        let mut bytes = vec![0u8; 20];
        bytes[0] = 20; // pFiles
        bytes.extend_from_slice(b"C:\\one.txt\0C:\\two.txt\0\0");
        assert_eq!(parse_hdrop(&bytes), vec!["C:\\one.txt", "C:\\two.txt"]);
    }

    fn dib_header(width: i32, height: i32, bpp: u16, compression: u32, colors: u32) -> Vec<u8> {
        let mut h = Vec::new();
        h.extend_from_slice(&40u32.to_le_bytes());
        h.extend_from_slice(&width.to_le_bytes());
        h.extend_from_slice(&height.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&bpp.to_le_bytes());
        h.extend_from_slice(&compression.to_le_bytes());
        h.extend_from_slice(&[0u8; 12]);
        h.extend_from_slice(&colors.to_le_bytes());
        h.extend_from_slice(&0u32.to_le_bytes());
        h
    }

    #[test]
    fn dib_24bit_bottom_up_with_row_padding() {
        // 2x2, rows padded to 8 bytes. Bottom row first: (blue, white); then top row: (red, green).
        let mut dib = dib_header(2, 2, 24, 0, 0);
        dib.extend_from_slice(&[255, 0, 0, 255, 255, 255, 0, 0]); // B,G,R per pixel: blue, white, pad
        dib.extend_from_slice(&[0, 0, 255, 0, 255, 0, 0, 0]); // red, green, pad
        let (w, h, rgba) = decode_dib(&dib).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&rgba[0..4], &[255, 0, 0, 255], "top-left is red");
        assert_eq!(&rgba[4..8], &[0, 255, 0, 255], "top-right is green");
        assert_eq!(&rgba[8..12], &[0, 0, 255, 255], "bottom-left is blue");
        assert_eq!(&rgba[12..16], &[255, 255, 255, 255]);
    }

    #[test]
    fn dib_32bit_zero_alpha_means_opaque_and_real_alpha_is_kept() {
        let mut opaque = dib_header(1, 1, 32, 0, 0);
        opaque.extend_from_slice(&[10, 20, 30, 0]);
        assert_eq!(decode_dib(&opaque).unwrap().2, vec![30, 20, 10, 255]);

        let mut translucent = dib_header(2, 1, 32, 0, 0);
        translucent.extend_from_slice(&[10, 20, 30, 128, 1, 2, 3, 0]);
        let rgba = decode_dib(&translucent).unwrap().2;
        assert_eq!(&rgba[0..4], &[30, 20, 10, 128]);
        assert_eq!(&rgba[4..8], &[3, 2, 1, 0]);
    }

    #[test]
    fn dib_8bit_palette_and_top_down() {
        let mut dib = dib_header(2, -1, 8, 0, 2);
        dib.extend_from_slice(&[0, 0, 255, 0, 0, 255, 0, 0]); // palette: red, green (BGRX)
        dib.extend_from_slice(&[1, 0, 0, 0]); // green, red, pad
        let rgba = decode_dib(&dib).unwrap().2;
        assert_eq!(&rgba[0..4], &[0, 255, 0, 255]);
        assert_eq!(&rgba[4..8], &[255, 0, 0, 255]);
    }

    #[test]
    fn dib_rejects_unsupported_and_oversized() {
        assert_eq!(decode_dib(&[0u8; 10]), Err(ImageError::Unsupported));
        assert_eq!(decode_dib(&dib_header(2, 2, 8, 1, 0)), Err(ImageError::Unsupported), "RLE");
        assert_eq!(decode_dib(&dib_header(100_000, 2, 24, 0, 0)), Err(ImageError::TooLarge));
        let truncated = dib_header(10, 10, 24, 0, 0);
        assert_eq!(decode_dib(&truncated), Err(ImageError::Unsupported));
    }

    #[test]
    fn dib_encode_decode_round_trip_and_alpha_composite() {
        let rgba = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 10, 10, 0];
        let dib = encode_dib(&rgba, 2, 2);
        let (w, h, back) = decode_dib(&dib).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(&back[0..12], &rgba[0..12]);
        assert_eq!(&back[12..16], &[255, 255, 255, 255], "fully transparent composites to white");
    }

    #[test]
    fn png_round_trip_and_thumbnail() {
        let (w, h) = (400u32, 200u32);
        let rgba: Vec<u8> = (0..w * h).flat_map(|i| [(i % 251) as u8, (i % 13) as u8, 7, 255]).collect();
        let png = encode_png(rgba.clone(), w, h).unwrap();
        let (dw, dh, decoded) = decode_encoded(&png, ImageFormat::Png).unwrap();
        assert_eq!((dw, dh), (w, h));
        assert_eq!(decoded, rgba);

        let thumb = make_thumbnail(&rgba, w, h).unwrap();
        let (tw, th, _) = decode_encoded(&thumb, ImageFormat::Png).unwrap();
        assert_eq!((tw, th), (192, 96));

        let small = make_thumbnail(&[1, 2, 3, 255], 1, 1).unwrap();
        assert_eq!(decode_encoded(&small, ImageFormat::Png).unwrap().0, 1);
    }

    #[test]
    fn jpeg_decodes_to_rgba() {
        let rgb = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 30, 30]));
        let mut jpeg = Vec::new();
        rgb.write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg).unwrap();
        let (w, h, rgba) = decode_encoded(&jpeg, ImageFormat::Jpeg).unwrap();
        assert_eq!((w, h), (8, 8));
        assert!(rgba[0] > 150 && rgba[1] < 80 && rgba[3] == 255);
        assert_eq!(decode_encoded(b"not an image", ImageFormat::Jpeg), Err(ImageError::Unsupported));
    }

    #[test]
    fn oversized_png_header_is_rejected_before_decoding() {
        // Build a valid PNG header claiming 20000x20000 pixels; decode must refuse via dimensions.
        fn crc32(data: &[u8]) -> u32 {
            let mut crc = 0xFFFF_FFFFu32;
            for byte in data {
                crc ^= *byte as u32;
                for _ in 0..8 {
                    crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
                }
            }
            !crc
        }
        let mut chunk = b"IHDR".to_vec();
        chunk.extend_from_slice(&20000u32.to_be_bytes());
        chunk.extend_from_slice(&20000u32.to_be_bytes());
        chunk.extend_from_slice(&[8, 6, 0, 0, 0]);
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(&chunk);
        png.extend_from_slice(&crc32(&chunk).to_be_bytes());
        // The decoder only reports dimensions once it reaches the first IDAT chunk.
        png.extend_from_slice(&4u32.to_be_bytes());
        png.extend_from_slice(b"IDAT");
        png.extend_from_slice(&[0, 0, 0, 0]);
        assert_eq!(decode_encoded(&png, ImageFormat::Png), Err(ImageError::TooLarge));
    }
}
