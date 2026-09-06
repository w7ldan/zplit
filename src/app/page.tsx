import { SiteHeader } from "@/components/editorial/site-header";
import { PublicMotion } from "@/components/editorial/public-motion";
import {
  CollaborationScene,
  ContextsScene,
  HeroScene,
  LandingFinale,
  PrivateAndHistoryScene,
  ProofScene,
  RecordFlowScene,
} from "@/components/editorial/public-scenes";

export default function HomePage() {
  return (
    <PublicMotion>
      <SiteHeader />
      <main>
        <HeroScene />
        <RecordFlowScene />
        <ContextsScene />
        <CollaborationScene />
        <ProofScene />
        <PrivateAndHistoryScene />
      </main>
      <LandingFinale />
    </PublicMotion>
  );
}
