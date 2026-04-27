interface Props {
  values: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ values, width = 80, height = 28 }: Props) {
  if (values.length === 0) {
    return <div className="sparkline empty" style={{ width, height }} />;
  }
  const max = Math.max(1, ...values);
  const barWidth = width / values.length - 2;
  return (
    <svg width={width} height={height} className="sparkline">
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (barWidth + 2)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={1}
            fill={i === values.length - 1 ? 'var(--accent)' : 'rgba(255,255,255,0.18)'}
          />
        );
      })}
    </svg>
  );
}
