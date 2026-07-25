import { LandingNav } from "../../components/LandingNav";
import { LandingHero } from "../../components/LandingHero";
import { LandingStatStrip } from "../../components/LandingStatStrip";
import { LandingProblem } from "../../components/LandingProblem";
import { LandingAgentsBar } from "../../components/LandingAgentsBar";
import { LandingFeaturesShowcase } from "../../components/LandingFeaturesShowcase";
import { LandingLocalFirst } from "../../components/LandingLocalFirst";
import { LandingInstall } from "../../components/LandingInstall";
import { LandingCTA } from "../../components/LandingCTA";
import { LandingFooter } from "../../components/LandingFooter";
import { LandingMachineDoc } from "../../components/LandingMachineDoc";
import { LandingModeToggle } from "../../components/LandingModeToggle";
import { ScrollRevealProvider } from "../../components/ScrollRevealProvider";

export default function LandingPage() {
	return (
		<ScrollRevealProvider>
			<div className="landing-page relative z-10 min-h-screen">
				<div className="landing-human-only">
					<LandingNav />
					<LandingHero />
					<LandingStatStrip />
					<LandingProblem />
					<LandingFeaturesShowcase />
					<LandingAgentsBar />
					<LandingLocalFirst />
					<LandingInstall />
					<LandingCTA />
					<LandingFooter />
				</div>
				<div className="landing-machine-only">
					<LandingMachineDoc />
				</div>
				<LandingModeToggle />
			</div>
		</ScrollRevealProvider>
	);
}
