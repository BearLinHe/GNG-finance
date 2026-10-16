import { Truck } from "lucide-react";

export default function OakTransportAccounting() {
  return (
    <section className="oak-accounting-workspace" aria-label="OAK 运输部核算工作区">
      <div className="oak-accounting-head">
        <h2>核算明细</h2>
        <span className="oak-accounting-status">待配置</span>
      </div>
      <div className="oak-accounting-empty">
        <Truck size={32} strokeWidth={1.5} aria-hidden="true" />
        <h3>暂无核算数据</h3>
        <p>核算规则待配置</p>
      </div>
    </section>
  );
}
