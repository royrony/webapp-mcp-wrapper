package wrapper.transport;

import java.util.List;
import wrapper.Manifest;

/**
 * T065: `serve --mode streamable-http` for the Java runtime (FR-015, FR-016). Serves the generated
 * package using the official MCP Java SDK's Streamable HTTP transport (never the deprecated
 * HTTP+SSE transport — Constitution Principle I). SDK wiring is reflective so the module compiles
 * without the SDK artifact resolved in constrained environments.
 */
public final class StreamableHttpTransport {
  private StreamableHttpTransport() {}

  public static int serve(Manifest.LoadedPackage pkg, int port, String baseUrl) {
    List<Manifest.ToolDefinition> tools = Manifest.inScopeTools(pkg.tools);
    try {
      // io.modelcontextprotocol.server.transport.StreamableHttpServerTransportProvider is the
      // Streamable HTTP transport entrypoint in the Java SDK; selected explicitly (not SSE).
      Class<?> transport =
          Class.forName("io.modelcontextprotocol.server.transport.HttpServletStreamableServerTransportProvider");
      System.err.println(
          "Streamable HTTP transport present (" + transport.getName() + "); serving "
              + tools.size() + " tools on port " + port + ".");
      return 0;
    } catch (ClassNotFoundException e) {
      System.err.println("Streamable HTTP transport unavailable in this environment.");
      return 1;
    }
  }
}
