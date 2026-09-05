import { ActionLink } from "@/components/editorial/action-link";
import { FinancialModelScene, FindabilityScene, HeroLedger, CollaborationScene, LandingFinale, PrivateShareScene, ProofScene, ScopeScene } from "@/components/editorial/landing-scenes";
import { JourneyShowcase } from "@/components/editorial/journey-showcase";
import { LandingStoryMotion } from "@/components/editorial/landing-reveal";
import { SiteHeader } from "@/components/editorial/site-header";

export default function HomePage() {
  return (
    <LandingStoryMotion>
      <SiteHeader />

      <section
        className="landing-hero spatial-section"
        aria-labelledby="page-title"
        data-spatial-scene="hero"
      >
        <div className="hero-notation" aria-hidden="true">
          <span>RECORDS / PEOPLE / STATE</span>
          <span>SCROLL TO REARRANGE</span>
        </div>
        <div className="editorial-shell landing-hero__layout">
          <div className="landing-hero__content">
            <p className="technical-label">Zplit / the shared money record</p>
            <h1 id="page-title">Every amount has a trail.</h1>
            <p className="landing-hero__lede">
              Expenses, shares, repayments, proof, and the balance that follows—kept readable from the first amount to the last open share.
            </p>
            <div className="landing-hero__actions">
              <ActionLink href="/app" variant="primary">Open Zplit</ActionLink>
              <ActionLink href="#model" variant="quiet">
                Follow the record <span aria-hidden="true">↓</span>
              </ActionLink>
            </div>
            <p className="landing-hero__aside">
              <span>Personal · Groups · Organizations</span>
              <span>One visual language, distinct contexts.</span>
            </p>
          </div>
          <div className="landing-hero__visual"><HeroLedger /></div>
        </div>
        <div className="hero-rail" aria-hidden="true">
          <span>01</span><i /><span>Bandung day out</span><i /><span>open balance</span>
        </div>
      </section>

      <FinancialModelScene />
      <ScopeScene />
      <JourneyShowcase />
      <CollaborationScene />
      <ProofScene />
      <PrivateShareScene />
      <FindabilityScene />
      <LandingFinale />
    </LandingStoryMotion>
  );
}
