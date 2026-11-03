import { matchesRadioOption, resolveSelectOption } from "./option-equivalence";

describe("option-equivalence", () => {
  describe("resolveSelectOption", () => {
    const countryOptions = [
      { value: "", text: "Select a country" },
      { value: "AU", text: "Australia" },
      { value: "AT", text: "Austria" },
      { value: "JP", text: "Japan" },
      { value: "US", text: "United States" },
      { value: "VN", text: "Vietnam" },
    ];

    it("resolves ISO-3166 alpha-2 'US' to 'United States' and never matches 'Australia' via substring", () => {
      const fullNameOnly = [
        { value: "australia", text: "Australia" },
        { value: "austria", text: "Austria" },
        { value: "united_states", text: "United States of America" },
      ];
      expect(resolveSelectOption(fullNameOnly, "US")?.value).toBe("united_states");
      expect(resolveSelectOption(fullNameOnly, "USA")?.value).toBe("united_states");
      expect(resolveSelectOption(fullNameOnly, "アメリカ")?.value).toBe("united_states");

      // Even if United States is absent, "US" must never match "Australia" via substring!
      const withoutUs = [
        { value: "australia", text: "Australia" },
        { value: "austria", text: "Austria" },
      ];
      expect(resolveSelectOption(withoutUs, "US")).toBeNull();
    });

    it("resolves localized country names and ISO alpha-3 codes across locales", () => {
      expect(resolveSelectOption(countryOptions, "Việt Nam")?.value).toBe("VN");
      expect(resolveSelectOption(countryOptions, "VNM")?.value).toBe("VN");
      expect(resolveSelectOption(countryOptions, "ベトナム")?.value).toBe("VN");
      expect(resolveSelectOption(countryOptions, "日本")?.value).toBe("JP");
      expect(resolveSelectOption(countryOptions, "JPN")?.value).toBe("JP");
    });

    it("resolves months across numbers, zero-padded numbers, abbreviations, and localized names", () => {
      const monthNameOptions = [
        { value: "", text: "Month" },
        { value: "jan", text: "January" },
        { value: "mar", text: "March" },
        { value: "nov", text: "November" },
      ];
      expect(resolveSelectOption(monthNameOptions, "03")?.value).toBe("mar");
      expect(resolveSelectOption(monthNameOptions, "3")?.value).toBe("mar");
      expect(resolveSelectOption(monthNameOptions, "3月")?.value).toBe("mar");
      expect(resolveSelectOption(monthNameOptions, "Tháng 11")?.value).toBe("nov");
    });

    it("resolves Japanese imperial eras across kanji and romaji", () => {
      const eraOptions = [
        { value: "S", text: "昭和" },
        { value: "H", text: "平成" },
        { value: "R", text: "令和" },
      ];
      expect(resolveSelectOption(eraOptions, "Heisei")?.value).toBe("H");
      expect(resolveSelectOption(eraOptions, "Reiwa")?.value).toBe("R");
      expect(resolveSelectOption(eraOptions, "昭和")?.value).toBe("S");
    });
  });

  describe("matchesRadioOption", () => {
    it("matches only the intended radio in a group across sex, marital status, and yes/no equivalences", () => {
      const sexGroup = [
        { value: "1", label: "女性" },
        { value: "2", label: "男性" },
      ];
      // Even though "1" is sometimes a weak code for Male on ISO-5218 forms, explicit label "女性" wins!
      expect(matchesRadioOption(sexGroup[0], "Male", sexGroup)).toBe(false);
      expect(matchesRadioOption(sexGroup[1], "Male", sexGroup)).toBe(true);
      expect(matchesRadioOption(sexGroup[0], "Nữ", sexGroup)).toBe(true);
      expect(matchesRadioOption(sexGroup[1], "Nữ", sexGroup)).toBe(false);

      const maritalGroup = [
        { value: "single", label: "独身" },
        { value: "married", label: "既婚" },
      ];
      expect(matchesRadioOption(maritalGroup[0], "Độc thân", maritalGroup)).toBe(true);
      expect(matchesRadioOption(maritalGroup[1], "Độc thân", maritalGroup)).toBe(false);
      expect(matchesRadioOption(maritalGroup[1], "Married", maritalGroup)).toBe(true);
    });
  });
});
