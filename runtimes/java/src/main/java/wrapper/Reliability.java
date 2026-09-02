package wrapper;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;

/**
 * Java runtime reliability implementation of the shared spec (T023). Constants MUST match
 * core/src/runtime-spec/reliability-spec.ts and the Node/Python runtimes; the cross-language
 * conformance suite (T068) asserts this.
 */
public final class Reliability {
  public static final int MAX_ATTEMPTS = 3;
  public static final int BASE_DELAY_MS = 200;
  public static final int FACTOR = 2;
  public static final double JITTER_FRACTION = 0.5;
  public static final int[] TRANSIENT_STATUSES = {408, 429, 500, 502, 503, 504};

  private Reliability() {}

  public static boolean isRetryable(boolean idempotent, Integer status, boolean isTimeout) {
    if (!idempotent) {
      return false;
    }
    if (isTimeout) {
      return true;
    }
    if (status == null) {
      return false;
    }
    for (int s : TRANSIENT_STATUSES) {
      if (s == status) {
        return true;
      }
    }
    return false;
  }

  public static double baseDelayForAttempt(int attempt) {
    return BASE_DELAY_MS * Math.pow(FACTOR, attempt);
  }

  public static List<Double> backoffSchedule() {
    List<Double> waits = new ArrayList<>();
    for (int attempt = 0; attempt < MAX_ATTEMPTS - 1; attempt++) {
      waits.add(baseDelayForAttempt(attempt));
    }
    return waits;
  }

  public static String redactForLog(String value) {
    return value.replaceAll("(?i)(bearer\\s+)[A-Za-z0-9._-]+", "$1<redacted>");
  }

  /** Result of a reliable invocation. */
  public static final class InvokeResult {
    public final boolean ok;
    public final int attempts;
    public final Integer status;
    public final Object body;
    public final String error;

    public InvokeResult(boolean ok, int attempts, Integer status, Object body, String error) {
      this.ok = ok;
      this.attempts = attempts;
      this.status = status;
      this.body = body;
      this.error = error;
    }
  }

  /** A call returning (status, body); throwing indicates a timeout/transport error. */
  public interface Call {
    Object[] invoke(int attempt) throws Exception;
  }

  public static InvokeResult invokeWithReliability(
      String toolName, boolean idempotent, Call call, Logger log, Sleeper sleep) {
    long started = System.currentTimeMillis();
    int attempts = 0;
    String lastError = null;
    Integer lastStatus = null;

    for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      attempts = attempt + 1;
      try {
        Object[] res = call.invoke(attempt);
        int status = (int) res[0];
        lastStatus = status;
        if (status < 400) {
          log.log(logRecord(toolName, attempts, "success", started, null, "info"));
          return new InvokeResult(true, attempts, status, res[1], null);
        }
        lastError = "HTTP " + status;
        if (!isRetryable(idempotent, status, false) || attempt == MAX_ATTEMPTS - 1) {
          break;
        }
      } catch (Exception e) {
        lastError = redactForLog(String.valueOf(e.getMessage()));
        if (!isRetryable(idempotent, null, true) || attempt == MAX_ATTEMPTS - 1) {
          break;
        }
      }
      double jitter = 1 + (Math.random() * 2 - 1) * JITTER_FRACTION;
      sleep.sleepMs((long) (baseDelayForAttempt(attempt) * jitter));
    }

    log.log(logRecord(toolName, attempts, "failure", started, lastError, "error"));
    return new InvokeResult(false, attempts, lastStatus, null, lastError);
  }

  private static String logRecord(
      String toolName, int attempts, String outcome, long started, String error, String level) {
    String base =
        String.format(
            "{\"ts\":\"%s\",\"level\":\"%s\",\"event\":\"tool_invocation\",\"toolName\":\"%s\","
                + "\"attempts\":%d,\"outcome\":\"%s\",\"durationMs\":%d",
            Instant.now(), level, toolName, attempts, outcome,
            System.currentTimeMillis() - started);
    if (error != null) {
      base += ",\"error\":\"" + error.replace("\"", "'") + "\"";
    }
    return base + "}";
  }

  public interface Logger {
    void log(String record);
  }

  public interface Sleeper {
    void sleepMs(long ms);
  }

  public static final IntFunction<Double> DELAY = Reliability::baseDelayForAttempt;
}
