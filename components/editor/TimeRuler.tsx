import { formatTime, getTickInterval } from '@/lib/clipUtils'

interface Props {
  totalDuration: number
  zoom: number
}

export default function TimeRuler({ totalDuration, zoom }: Props) {
  const interval = getTickInterval(zoom)
  const ticks: number[] = []
  for (let t = 0; t <= totalDuration + interval; t += interval) {
    ticks.push(Math.round(t * 1000) / 1000)
  }

  return (
    <div className="relative h-8 bg-neutral-950 border-b border-neutral-800 shrink-0 overflow-hidden">
      {ticks.map(tick => (
        <div
          key={tick}
          className="absolute top-0 flex flex-col"
          style={{ left: tick * zoom }}
        >
          <div className="w-px h-2.5 bg-neutral-600" />
          <span className="text-[10px] text-neutral-500 pl-1 leading-tight whitespace-nowrap mt-0.5">
            {formatTime(tick)}
          </span>
        </div>
      ))}
    </div>
  )
}
