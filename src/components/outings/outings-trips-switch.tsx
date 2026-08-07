import Link from "next/link";

type OutingsTripsSwitchProps = { current: "outings" | "trips" };

export function OutingsTripsSwitch({ current }: OutingsTripsSwitchProps) {
  return (
    <nav className="outings-trips-switch" aria-label="Outings and Trips views">
      <Link className={current === "outings" ? "outings-trips-switch__link outings-trips-switch__link--selected" : "outings-trips-switch__link"} href="/app/outings" aria-current={current === "outings" ? "page" : undefined}>Outings</Link>
      <Link className={current === "trips" ? "outings-trips-switch__link outings-trips-switch__link--selected" : "outings-trips-switch__link"} href="/app/trips" aria-current={current === "trips" ? "page" : undefined}>Trips</Link>
    </nav>
  );
}
