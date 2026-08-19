import json
import unreal
import toolset_registry


@unreal.uclass()
class PhantomPlayPortfolioTools(unreal.ToolsetDefinition):
    """PhantomPlay-specific context tools for the four-game Unreal portfolio."""

    @staticmethod
    @toolset_registry.tool_call
    def get_portfolio_context() -> str:
        """Return the current PhantomPlay editor context and protected four-game identity contract.

        Returns:
            JSON text describing the current level, selected actors, and all four PhantomPlay game IDs.
        """
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        selected = actor_subsystem.get_selected_level_actors() if actor_subsystem else []
        level_name = world.get_path_name() if world else ""
        return json.dumps({
            "portfolio": [
                {"name": "PhantomStrike", "runtime_id": "phantom-strike"},
                {"name": "Phantom Ages", "runtime_id": "phantom-ages"},
                {"name": "Phantom Legends", "runtime_id": "phantom-legends"},
                {"name": "CubeTown", "runtime_id": "cubetown"},
            ],
            "current_world": level_name,
            "selected_actors": [a.get_actor_label() for a in selected if a],
            "selected_count": len(selected),
            "rule": "Never silently replace one game's identity or let one passing game mask another failure."
        })

    @staticmethod
    @toolset_registry.tool_call
    def get_level_actor_summary(max_classes: int = 40) -> str:
        """Summarize actor classes in the currently open editor world.

        Args:
            max_classes: Maximum number of actor classes to return.

        Returns:
            JSON text with actor counts grouped by class.
        """
        actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        actors = actor_subsystem.get_all_level_actors() if actor_subsystem else []
        counts = {}
        for actor in actors:
            if not actor:
                continue
            cls = actor.get_class().get_name()
            counts[cls] = counts.get(cls, 0) + 1
        rows = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:max(1, min(max_classes, 200))]
        return json.dumps({"actor_count": len(actors), "classes": rows})
