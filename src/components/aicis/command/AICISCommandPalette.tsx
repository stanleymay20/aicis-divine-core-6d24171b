import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BrainCircuit } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useIntelligenceOS } from "@/hooks/useIntelligenceOS";
import {
  AICIS_WORKSPACES,
  persistedWorkspaceSearch,
} from "@/lib/aicis-workspaces";

export const AICISCommandPalette = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isCommandPaletteOpen,
    setCommandPaletteOpen,
    openAsk,
  } = useIntelligenceOS();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  const go = (path: string) => {
    setCommandPaletteOpen(false);
    const search = persistedWorkspaceSearch(location.search);
    navigate({
      pathname: path,
      search: search ? `?${search}` : "",
    });
  };

  return (
    <CommandDialog
      open={isCommandPaletteOpen}
      onOpenChange={setCommandPaletteOpen}
    >
      <CommandInput placeholder="Search workspaces or run a command…" />
      <CommandList>
        <CommandEmpty>No matching AICIS command.</CommandEmpty>
        <CommandGroup heading="Intelligence">
          <CommandItem
            value="Ask AICIS contextual intelligence research"
            onSelect={() => {
              setCommandPaletteOpen(false);
              openAsk();
            }}
          >
            <BrainCircuit className="mr-2 h-4 w-4 text-primary" />
            Ask AICIS
            <CommandShortcut>AI</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Workspaces">
          {AICIS_WORKSPACES.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.path}
                value={`${item.label} ${item.keywords}`}
                onSelect={() => go(item.path)}
              >
                <Icon className="mr-2 h-4 w-4" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
