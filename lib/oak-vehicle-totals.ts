import type {VehicleAccountingLine,VehicleField} from './oak-vehicle-accounting';
const costs=['maintenance','labor','fuel','insurance'] as const;
export const vehicleCostShortLabels:Record<typeof costs[number],string>={maintenance:'维修费',labor:'工资',fuel:'油费',insurance:'保险'};

// Presentation-only subtotals never replace the confirmed accounting result.
export function vehicleTotalsPreview(lines:Record<VehicleField,VehicleAccountingLine>,otherAmount:number|null){
 const missingCosts=costs.filter(field=>lines[field].amount==null);
 const amounts=costs.map(field=>lines[field].amount??lines[field].knownAmount).filter((amount):amount is number=>amount!=null&&Number.isFinite(amount));
 const knownCost=otherAmount==null||(!amounts.length&&otherAmount===0)?null:(amounts.reduce((sum,amount)=>sum+Math.round(amount*100),0)+Math.round(otherAmount*100))/100;
 const provisionalNet=knownCost!=null&&lines.income.amount!=null?(Math.round(lines.income.amount*100)-Math.round(knownCost*100))/100:null;
 return {knownCost,provisionalNet,missingCosts,pendingCosts:missingCosts.map(field=>vehicleCostShortLabels[field]).join('、')};
}
