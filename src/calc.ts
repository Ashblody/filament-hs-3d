import {
  DEFAULT_FAILURE_RATE,
  DEFAULT_MARKUP,
  ENERGY_COST,
  LABOR_RATE,
  findMaterial,
  findPrinter,
} from './data.ts'
import type { CalcBreakdown, CalcInput } from './types.ts'

export function calculatePrice(input: CalcInput): CalcBreakdown {
  const printer = findPrinter(input.printerId)
  const material = findMaterial(input.materialId)
  const printHours = Math.max(0, input.printHours)
  const weightG = Math.max(0, input.weightG)
  const prepMin = Math.max(0, input.prepMin)
  const postMin = Math.max(0, input.postMin)
  const consumables = Math.max(0, input.consumables)
  const markup = input.markup > 0 ? input.markup : DEFAULT_MARKUP
  const failureRate =
    input.failureRate >= 0 ? input.failureRate : DEFAULT_FAILURE_RATE

  const filamentCost = (weightG / 1000) * material.pricePerKg
  const electricity = printHours * printer.energyKwhPerH * ENERGY_COST
  const depreciation =
    printHours * (printer.price + printer.serviceCost) / printer.lifeHours
  const preparation = (prepMin / 60) * LABOR_RATE
  const postProcessing = (postMin / 60) * LABOR_RATE
  const subtotal =
    filamentCost +
    electricity +
    depreciation +
    preparation +
    postProcessing +
    consumables
  const withFailures = subtotal * (1 + failureRate / 100)
  const suggested = withFailures * markup

  return {
    filamentCost,
    electricity,
    depreciation,
    preparation,
    postProcessing,
    consumables,
    subtotal,
    withFailures,
    suggested,
    printHours,
  }
}

/** Sanity check sample: 61.46g Trcek PLA, 3:46, CORE ONE INDX → ≈ 25.90 € */
export function sanitySuggested(): number {
  return calculatePrice({
    printerId: 'core-one-indx',
    materialId: 'trcek-pla',
    weightG: 61.46,
    printHours: 3 + 46 / 60,
    prepMin: 20,
    postMin: 10,
    consumables: 0,
    markup: 1.5,
    failureRate: 20,
  }).suggested
}
