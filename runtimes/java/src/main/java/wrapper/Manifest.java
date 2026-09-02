package wrapper;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;

/** Manifest loading for the Java runtime (mirrors runtimes/node/src/manifest.ts). */
public final class Manifest {
  private static final Gson GSON = new Gson();

  public static final class ToolAnnotations {
    public boolean readOnlyHint;
    public boolean destructiveHint;
    public boolean idempotentHint;
  }

  public static final class ToolDefinition {
    public String name;
    public String description;
    public JsonObject inputSchema;
    public JsonObject outputSchema;
    public ToolAnnotations annotations;
    public boolean includedByDefault;
    public String sourceIdentityKey;
  }

  public static final class LoadedPackage {
    public final Path dir;
    public final JsonObject manifest;
    public final List<ToolDefinition> tools;
    public final JsonObject oauthConfig;
    public final List<String> scope;

    LoadedPackage(
        Path dir,
        JsonObject manifest,
        List<ToolDefinition> tools,
        JsonObject oauthConfig,
        List<String> scope) {
      this.dir = dir;
      this.manifest = manifest;
      this.tools = tools;
      this.oauthConfig = oauthConfig;
      this.scope = scope;
    }
  }

  private Manifest() {}

  public static LoadedPackage loadPackage(Path dir) throws IOException {
    JsonObject manifest =
        GSON.fromJson(Files.readString(dir.resolve("package-manifest.json")), JsonObject.class);
    Type listType = new TypeToken<List<ToolDefinition>>() {}.getType();
    List<ToolDefinition> tools = GSON.fromJson(Files.readString(dir.resolve("tools.json")), listType);
    JsonObject oauth =
        GSON.fromJson(Files.readString(dir.resolve("oauthConfig.json")), JsonObject.class);
    List<String> scope = null;
    Path scopePath = dir.resolve("tool-scope.json");
    if (Files.exists(scopePath)) {
      JsonObject scopeObj = GSON.fromJson(Files.readString(scopePath), JsonObject.class);
      if (scopeObj != null && scopeObj.has("tools")) {
        Type strList = new TypeToken<List<String>>() {}.getType();
        scope = GSON.fromJson(scopeObj.get("tools"), strList);
      }
    }
    return new LoadedPackage(dir, manifest, tools, oauth, scope);
  }

  /** Tools in the served scope: the tool-scope.json set when present, else includedByDefault. */
  public static List<ToolDefinition> inScopeTools(List<ToolDefinition> tools, List<String> scope) {
    if (scope != null) {
      return tools.stream().filter(t -> scope.contains(t.name)).collect(Collectors.toList());
    }
    return tools.stream().filter(t -> t.includedByDefault).collect(Collectors.toList());
  }

  /** Convenience overload using includedByDefault. */
  public static List<ToolDefinition> inScopeTools(List<ToolDefinition> tools) {
    return inScopeTools(tools, null);
  }
}
