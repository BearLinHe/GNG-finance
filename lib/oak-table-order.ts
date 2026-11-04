export function reconcileTableOrder(stored:readonly string[],available:readonly string[]) {
  const valid=new Set(available);
  return [...new Set([...stored.filter(id=>valid.has(id)),...available])];
}
export function moveTableItem(order:readonly string[],from:string,to:string) {
  const next=[...order];const start=next.indexOf(from),end=next.indexOf(to);
  if(start<0||end<0||start===end)return next;
  next.splice(start,1);next.splice(end,0,from);return next;
}
