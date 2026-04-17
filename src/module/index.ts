import { defineModule } from '@directus/extensions-sdk'
import ModuleRoot from './ModuleRoot.vue'
import Activation from './views/Activation.vue'
import PolicyEditor from './views/PolicyEditor.vue'
import CrawlerLog from './views/CrawlerLog.vue'
import Settings from './views/Settings.vue'
import Upgrade from './views/Upgrade.vue'

export default defineModule({
  id: 'gated',
  name: 'Gated — AI Policy',
  icon: 'shield',
  routes: [
    {
      path: '',
      component: ModuleRoot,
      children: [
        { path: '', redirect: '/gated/policy' },
        { path: 'activation', component: Activation },
        { path: 'policy', component: PolicyEditor },
        { path: 'crawlers', component: CrawlerLog },
        { path: 'settings', component: Settings },
        { path: 'upgrade', component: Upgrade },
      ],
    },
  ],
})
