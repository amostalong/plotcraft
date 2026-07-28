import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/session' },
    {
      path: '/overview',
      component: () => import('@/views/OverviewView.vue'),
    },
    {
      path: '/world',
      component: () => import('@/views/WorldView.vue'),
    },
    {
      path: '/characters',
      component: () => import('@/views/CharactersView.vue'),
    },
    {
      path: '/plot',
      component: () => import('@/views/PlotView.vue'),
    },
    {
      path: '/art',
      component: () => import('@/views/ConceptArtView.vue'),
    },
    {
      path: '/session',
      component: () => import('@/views/SessionView.vue'),
    },
    {
      path: '/settings',
      component: () => import('@/views/SettingsView.vue'),
    },
  ],
})

export { router }
