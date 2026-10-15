import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardChartsProps {
  distribution: Array<{ name: string; value: number; color: string }>;
  dimensions: Array<{ name: string; count: unknown }>;
}

function ChartValues({ title, category, rows }: {
  title: string;
  category: string;
  rows: Array<{ name: string; count: unknown }>;
}) {
  return (
    <details className="px-6 pb-6">
      <summary className="cursor-pointer text-sm font-medium rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        View {title.toLowerCase()} values
      </summary>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">{title} values</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="py-2 text-left">{category}</th>
            <th scope="col" className="py-2 text-right">Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.name} className="border-b">
              <th scope="row" className="py-2 text-left font-normal">{row.name}</th>
              <td className="py-2 text-right tabular-nums">{String(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
/** Kept behind a lazy boundary so an empty workspace never downloads Recharts. */
export default function DashboardCharts({ distribution, dimensions }: DashboardChartsProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <Card className="flex flex-col h-full shadow-sm">
        <CardHeader><CardTitle>Classification Distribution</CardTitle></CardHeader>
        <CardContent className="h-[310px]">
          {distribution.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No classified values to display.
            </p>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={distribution} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                {distribution.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
              <Legend verticalAlign="bottom" height={36} />
            </PieChart>
          </ResponsiveContainer>
          )}
        </CardContent>
        {distribution.length > 0 && (
          <ChartValues title="Classification distribution" category="Classification"
            rows={distribution.map(({ name, value }) => ({ name, count: value }))} />
        )}
      </Card>
      <Card className="flex flex-col h-full shadow-sm">
        <CardHeader><CardTitle>Findings by Dimension</CardTitle></CardHeader>
        <CardContent className="h-[310px] pb-4">
          {dimensions.length === 0 ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No findings to display by dimension.
            </p>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dimensions} layout="vertical" margin={{ left: 50, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} opacity={0.3} />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12, fill: "currentColor" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ borderRadius: "8px" }} />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </CardContent>
        {dimensions.length > 0 && (
          <ChartValues title="Findings by dimension" category="Dimension" rows={dimensions} />
        )}
      </Card>
    </div>
  );
}
