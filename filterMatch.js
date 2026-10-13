// checks whether a car matches a user's filter (price, year, mileage, make, model)

const normaliseText = (value) => String(value ?? '').toLowerCase().replace(/[_-]/g, ' ').trim()
const isWildcard = (value) => value == null || value === '' || normaliseText(value) === 'any'

// a bound that isn't set always passes. A bound that is set fails if the car has no value,
// so cars with unknown mileage/year don't slip through a "max mileage" filter.
const withinRange = (value, min, max) => {
    if (min != null && (value == null || value < min)) return false
    if (max != null && (value == null || value > max)) return false
    return true
}

export function matchesFilter(car, filter) {
    return withinRange(car.price, filter.minPrice, filter.maxPrice) &&
        withinRange(car.year, filter.minYear, filter.maxYear) &&
        withinRange(car.mileage, filter.minMileage, filter.maxMileage) &&
        (isWildcard(filter.make) || normaliseText(filter.make) === normaliseText(car.make)) &&
        (isWildcard(filter.model) || normaliseText(filter.model) === normaliseText(car.model))
}
