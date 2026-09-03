import { auditWebHtml } from "./web-audit"

describe("bounded website audit", () => {
  test("reports controls and obvious accessibility/resource findings without submission", () => {
    const result = auditWebHtml({
      url: "http://localhost:3000/login",
      status: 200,
      html: '<title>Demo</title><form><button></button><a href="javascript:void(0)">Open</a></form>',
    })
    expect(result.title).toBe("Demo")
    expect(result.controls).toEqual({ buttons: 1, links: 1, forms: 1 })
    expect(result.findings.some((finding) => finding.kind === "accessibility")).toBe(true)
    expect(result.findings.some((finding) => finding.kind === "link")).toBe(true)
    expect(result.submitted).toBe(false)
  })

  test("reports HTTP failures and pages with no standard controls", () => {
    const result = auditWebHtml({ url: "https://example.com", status: 500, html: "<main>broken</main>" })
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", kind: "resource" }),
        expect.objectContaining({ severity: "info" }),
      ]),
    )
  })
})
