//! A UTC timestamp for set-aside file names, without a date-time dependency.

/// `secs` since the Unix epoch as `YYYYMMDDTHHMMSSZ`.
pub fn utc_stamp(secs: u64) -> String {
    let (hour, minute, second) = ((secs % 86_400) / 3_600, (secs % 3_600) / 60, secs % 60);
    let (year, month, day) = civil_from_days(i64::try_from(secs / 86_400).unwrap_or(i64::MAX / 2));
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z")
}

/// Days since 1970-01-01 to (year, month, day) in the proleptic Gregorian calendar
/// (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 };
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

#[cfg(test)]
mod tests {
    use super::utc_stamp;

    #[test]
    fn formats_known_instants() {
        assert_eq!(utc_stamp(0), "19700101T000000Z");
        assert_eq!(utc_stamp(1_700_000_000), "20231114T221320Z");
        // A leap day, and the last second of a year.
        assert_eq!(utc_stamp(1_709_164_800), "20240229T000000Z");
        assert_eq!(utc_stamp(1_735_689_599), "20241231T235959Z");
    }

    #[test]
    fn absurd_times_do_not_panic() {
        assert!(utc_stamp(u64::MAX).len() > 10);
    }
}
