import Link from "next/link";

type OutingsTripsSwitchProps = { current: "outings" | "trips"; basePath?: string };

export function OutingsTripsSwitch({ current, basePath = "/app" }: OutingsTripsSwitchProps) {
  return (
    <nav className="outings-trips-switch personal-vnext__view-switch" aria-label="Outings and Trips views">
      <Link className={current === "outings" ? "outings-trips-switch__link outings-trips-switch__link--selected vnext-link" : "outings-trips-switch__link vnext-link"} href={`${basePath}/outings`} aria-current={current === "outings" ? "page" : undefined}>Outings</Link>
      <Link className={current === "trips" ? "outings-trips-switch__link outings-trips-switch__link--selected vnext-link" : "outings-trips-switch__link vnext-link"} href={`${basePath}/trips`} aria-current={current === "trips" ? "page" : undefined}>Trips</Link>
    </nav>
  );
}
