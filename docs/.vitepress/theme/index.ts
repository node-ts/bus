import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Card from './components/Card.vue'
import Diagram from './components/Diagram.vue'
import FeatureGrid from './components/FeatureGrid.vue'
import PackageBadge from './components/PackageBadge.vue'
import Steps from './components/Steps.vue'
import Layout from './Layout.vue'
import './style.css'

/**
 * The default VitePress theme with the brand styles, a custom home hero and the components pages may use. Only use
 * the components registered here, as listed in docs/README.md, so pages stay consistent.
 */
const theme: Theme = {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('Card', Card)
    app.component('Diagram', Diagram)
    app.component('FeatureGrid', FeatureGrid)
    app.component('PackageBadge', PackageBadge)
    app.component('Steps', Steps)
  }
}

export default theme
