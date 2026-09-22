import { zplitVNextFont } from "@/app/fonts";
import { PublicLanding } from "@/components/editorial/public-landing";
import { SiteHeader } from "@/components/editorial/site-header";

export default function HomePage() {
  return (
    <div className={`public-vnext zplit-vnext ${zplitVNextFont.variable}`} id="top">
      <SiteHeader />
      <PublicLanding />
    </div>
  );
}
