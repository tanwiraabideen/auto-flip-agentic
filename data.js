
export const yearFilters = [
    { label: "Any", urlValue: "any" },
    { label: "Up to 1 year", urlValue: "up_to_1", year: 2024 },
    { label: "Up to 2 years", urlValue: "up_to_2", year: 2023 },
    { label: "Up to 3 years", urlValue: "up_to_3", year: 2022 },
    { label: "Up to 4 years", urlValue: "up_to_4", year: 2021 },
    { label: "Up to 5 years", urlValue: "up_to_5", year: 2020 },
    { label: "Up to 6 years", urlValue: "up_to_6", year: 2019 },
    { label: "Up to 7 years", urlValue: "up_to_7", year: 2018 },
    { label: "Up to 8 years", urlValue: "up_to_8", year: 2017 },
    { label: "Up to 9 years", urlValue: "up_to_9", year: 2016 },
    { label: "Up to 10 years", urlValue: "up_to_10", year: 2015 },
];

export const mileageFilters = [
    { label: "Any", urlValue: "any", integerValue: 100000000 },
    { label: "Up to 15,000 miles", urlValue: "up_to_15000", integerValue: 15000 },
    { label: "Up to 30,000 miles", urlValue: "up_to_30000", integerValue: 30000 },
    { label: "Up to 60,000 miles", urlValue: "up_to_60000", integerValue: 60000 },
    { label: "Up to 80,000 miles", urlValue: "up_to_80000", integerValue: 80000 },
];

export const getMileage = (urlValue) => mileageFilters.find((item) => item.urlValue === urlValue)?.integerValue

export const getYear = (urlValue) => yearFilters.find((item) => item.urlValue === urlValue)?.year
