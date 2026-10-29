export const leg = { date: "2027-01-20", fromAirport: "JFK", toAirport: "LAX" };
export const returnLeg = { date: "2027-01-27", fromAirport: "LAX", toAirport: "JFK" };

export function segment(number = "1", from = "JFK", to = "LAX", hour = 9, date = [2027, 1, 20]) {
  const value: unknown[] = [];
  value[3] = from; value[4] = from;
  value[6] = to; value[5] = to;
  value[8] = [hour, 0]; value[10] = [hour + 2, 0];
  value[11] = 120; value[17] = "Boeing 737";
  value[20] = value[21] = date;
  value[22] = ["AA", number];
  return value;
}

export function row(segments = [segment()], layovers: unknown[] = [], price = 129) {
  const flight: unknown[] = ["AA", ["American"], segments];
  flight[9] = 120 * segments.length;
  flight[10] = segments.length - 1;
  flight[13] = layovers;
  flight[22] = [null, null, null, null, null, null, null, 100, 200];
  return [flight, [[null, price]]];
}

export function payload(rows: unknown[]) {
  return [null, null, null, [rows], null, null, null, [null, [[], [["AA", "American"]]]]];
}

export function html(rows: unknown[] = [row()]) {
  return `<script class="ds:1">AF_initDataCallback({key: 'ds:1',hash: 'test',data:${JSON.stringify(payload(rows))},sideChannel:{}});</script>`;
}
