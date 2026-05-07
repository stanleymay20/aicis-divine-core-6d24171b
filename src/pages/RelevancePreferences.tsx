import { RelevancePreferencesPanel } from "@/components/relevance/RelevancePreferencesPanel";

export default function RelevancePreferences() {
  return (
    <div className="container mx-auto max-w-3xl py-6 px-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold">Relevance Preferences</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Personalize how AICIS scores incoming signals against your operational footprint.
          These preferences power the fallback relevance engine and the optional AI model.
        </p>
      </div>
      <RelevancePreferencesPanel />
    </div>
  );
}
