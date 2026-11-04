use vowkey_capture::format::{parse_japanese_date, to_wareki};

#[test]
fn valid_dates_round_trip_through_japanese_eras_and_digit_widths() {
    for (iso, era) in [
        ("1868-01-25", "明治"),
        ("1912-07-29", "明治"),
        ("1912-07-30", "大正"),
        ("1926-12-24", "大正"),
        ("1926-12-25", "昭和"),
        ("1989-01-07", "昭和"),
        ("1989-01-08", "平成"),
        ("2019-04-30", "平成"),
        ("2019-05-01", "令和"),
    ] {
        assert_eq!(to_wareki(iso).expect("supported date").era_kanji, era);
    }

    for year in 1868..=2100 {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        for month in 1..=12 {
            let days = match month {
                2 if leap => 29,
                2 => 28,
                4 | 6 | 9 | 11 => 30,
                _ => 31,
            };
            for day in 1..=days {
                if (year, month, day) < (1868, 1, 25) {
                    continue;
                }
                let iso = format!("{year:04}-{month:02}-{day:02}");
                let wareki = to_wareki(&iso).expect("supported date");
                for use_gannen in [false, true] {
                    let printed = wareki.format_kanji(use_gannen);
                    let fullwidth: String = printed
                        .chars()
                        .map(|c| {
                            if c.is_ascii_digit() {
                                char::from_u32(u32::from(c) + 0xfee0).expect("full-width digit")
                            } else {
                                c
                            }
                        })
                        .collect();
                    for input in [&printed, &fullwidth] {
                        assert_eq!(
                            parse_japanese_date(input).as_deref(),
                            Some(iso.as_str()),
                            "{input}"
                        );
                    }
                }
            }
        }
    }
}
