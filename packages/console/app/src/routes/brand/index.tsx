import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { useI18n } from "~/context/i18n"
import { LocaleLinks } from "~/component/locale-links"
import previewLogoLight from "../../asset/brand/preview-nexus-logo-light.png"
import previewLogoDark from "../../asset/brand/preview-nexus-logo-dark.png"
import previewLogoLightSquare from "../../asset/brand/preview-nexus-logo-light-square.png"
import previewLogoDarkSquare from "../../asset/brand/preview-nexus-logo-dark-square.png"
import previewWordmarkLight from "../../asset/brand/preview-nexus-wordmark-light.png"
import previewWordmarkDark from "../../asset/brand/preview-nexus-wordmark-dark.png"
import previewWordmarkSimpleLight from "../../asset/brand/preview-nexus-wordmark-simple-light.png"
import previewWordmarkSimpleDark from "../../asset/brand/preview-nexus-wordmark-simple-dark.png"
import logoLightPng from "../../asset/brand/nexus-logo-light.png"
import logoDarkPng from "../../asset/brand/nexus-logo-dark.png"
import logoLightSquarePng from "../../asset/brand/nexus-logo-light-square.png"
import logoDarkSquarePng from "../../asset/brand/nexus-logo-dark-square.png"
import wordmarkLightPng from "../../asset/brand/nexus-wordmark-light.png"
import wordmarkDarkPng from "../../asset/brand/nexus-wordmark-dark.png"
import wordmarkSimpleLightPng from "../../asset/brand/nexus-wordmark-simple-light.png"
import wordmarkSimpleDarkPng from "../../asset/brand/nexus-wordmark-simple-dark.png"
import logoLightSvg from "../../asset/brand/nexus-logo-light.svg"
import logoDarkSvg from "../../asset/brand/nexus-logo-dark.svg"
import logoLightSquareSvg from "../../asset/brand/nexus-logo-light-square.svg"
import logoDarkSquareSvg from "../../asset/brand/nexus-logo-dark-square.svg"
import wordmarkLightSvg from "../../asset/brand/nexus-wordmark-light.svg"
import wordmarkDarkSvg from "../../asset/brand/nexus-wordmark-dark.svg"
import wordmarkSimpleLightSvg from "../../asset/brand/nexus-wordmark-simple-light.svg"
import wordmarkSimpleDarkSvg from "../../asset/brand/nexus-wordmark-simple-dark.svg"
const brandAssets = "/nexus-brand-assets.zip"

export default function Brand() {
  const i18n = useI18n()
  const alt = i18n.t("brand.meta.description")
  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)

      const link = document.createElement("a")
      link.href = blobUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error("Download failed:", error)
      const link = document.createElement("a")
      link.href = url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <main data-page="enterprise">
      <Title>{i18n.t("brand.title")}</Title>
      <LocaleLinks path="/brand" />
      <Meta name="description" content={i18n.t("brand.meta.description")} />
      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="brand-content">
            <h1>{i18n.t("brand.heading")}</h1>
            <p>{i18n.t("brand.subtitle")}</p>
            <button
              data-component="download-button"
              onClick={() => downloadFile(brandAssets, "nexus-brand-assets.zip")}
            >
              {i18n.t("brand.downloadAll")}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="square"
                />
              </svg>
            </button>

            <div data-component="brand-grid">
              <div>
                <img src={previewLogoLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightPng, "nexus-logo-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoLightSvg, "nexus-logo-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkPng, "nexus-logo-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoDarkSvg, "nexus-logo-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoLightSquare} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoLightSquarePng, "nexus-logo-light-square.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoLightSquareSvg, "nexus-logo-light-square.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewLogoDarkSquare} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(logoDarkSquarePng, "nexus-logo-dark-square.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(logoDarkSquareSvg, "nexus-logo-dark-square.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkLightPng, "nexus-wordmark-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkLightSvg, "nexus-wordmark-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkDarkPng, "nexus-wordmark-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkDarkSvg, "nexus-wordmark-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleLight} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleLightPng, "nexus-wordmark-simple-light.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleLightSvg, "nexus-wordmark-simple-light.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <img src={previewWordmarkSimpleDark} alt={alt} />
                <div data-component="actions">
                  <button onClick={() => downloadFile(wordmarkSimpleDarkPng, "nexus-wordmark-simple-dark.png")}>
                    PNG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                  <button onClick={() => downloadFile(wordmarkSimpleDarkSvg, "nexus-wordmark-simple-dark.svg")}>
                    SVG
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="square"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
        <Footer />
      </div>
      <Legal />
    </main>
  )
}
