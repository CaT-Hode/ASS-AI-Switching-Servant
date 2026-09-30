import React from 'react';
import { SlidersHorizontal, RotateCw, Power } from './icons.jsx';
export function ClientProcessChoice({ plan, value, onChange, disabled, actionLabel = '仅应用配置' }) {
  if (!plan?.applicable) return null;
  const choices = [['none', actionLabel, SlidersHorizontal, true], ['close', '强制关闭', Power, plan.closeAvailable], ['restart', '强制重启', RotateCw, plan.available]];
  return <div className="connection-restart" data-force={value !== 'none' || undefined}>
    <div className="connection-restart-choices" role="radiogroup" aria-label="客户端生效方式">
      {choices.map(([id, label, Icon, available]) => <label key={id}>
        <input type="radio" name="client-process-choice" value={id} checked={value === id} disabled={disabled || !available} onChange={() => onChange(id)} />
        <span><Icon size={14} />{label}</span></label>)}
    </div><small>{value === 'none' ? plan.reason || '不关闭客户端，请先结束任务；已有窗口需重新打开后生效。' : value === 'close' ? '将中断所选客户端任务，不重新打开。' : '将中断所选客户端任务，再重新打开。'}</small>
  </div>;
}
