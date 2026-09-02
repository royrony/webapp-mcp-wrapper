package wrapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Asserts the Java runtime's reliability constants match the shared spec (Principle VI). */
class ReliabilityTest {
  @Test
  void retryGating() {
    assertTrue(Reliability.isRetryable(true, 503, false));
    assertTrue(Reliability.isRetryable(true, 429, false));
    assertTrue(Reliability.isRetryable(true, null, true));
    assertFalse(Reliability.isRetryable(true, 404, false));
    assertFalse(Reliability.isRetryable(false, 503, false));
    assertFalse(Reliability.isRetryable(false, null, true));
  }

  @Test
  void backoffSchedule() {
    List<Double> waits = Reliability.backoffSchedule();
    assertEquals(2, waits.size());
    assertEquals(200.0, waits.get(0));
    assertEquals(400.0, waits.get(1));
  }

  @Test
  void maxAttemptsIsThree() {
    assertEquals(3, Reliability.MAX_ATTEMPTS);
  }
}
