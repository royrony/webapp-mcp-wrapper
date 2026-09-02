"""pytest configuration marker test for the Python runtime.

Real behavioral tests live alongside the runtime modules; this asserts the
package layout is importable so `pytest` discovers the src/ path.
"""

def test_package_importable():
    import wrapper_runtime  # noqa: F401
