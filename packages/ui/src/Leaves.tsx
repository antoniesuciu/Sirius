const LEAVES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function Leaves() {
  return (
    <div className="leaves" aria-hidden="true">
      {LEAVES.map((n) => (
        <div className="lc" key={n}>
          <div className="leaf" />
        </div>
      ))}
    </div>
  );
}
