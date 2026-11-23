// Deterministic synthetic datasets for the fast-data-apps prototype.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let seed = 42
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const pick = (arr, weights) => {
  if (!weights) return arr[Math.floor(rand() * arr.length)]
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i]
    if (r <= 0) return arr[i]
  }
  return arr[arr.length - 1]
}
const iso = d => d.toISOString().slice(0, 10)
const toCsv = rows => {
  const cols = Object.keys(rows[0])
  const esc = v => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : String(v))
  return `${cols.join(',')}\n${rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n')}\n`
}

// orders: e-commerce order lines over 2 years
const products = {
  Electronics: [
    ['Headphones', 129],
    ['Smartwatch', 249],
    ['Speaker', 89],
    ['Tablet', 399],
  ],
  Home: [
    ['Lamp', 45],
    ['Blender', 79],
    ['Rug', 149],
    ['Chair', 189],
  ],
  Apparel: [
    ['Jacket', 119],
    ['Sneakers', 95],
    ['T-shirt', 25],
    ['Backpack', 65],
  ],
  Beauty: [
    ['Serum', 39],
    ['Perfume', 85],
    ['Shampoo', 14],
  ],
}
const orders = []
const start = new Date('2024-11-01')
for (let i = 0; i < 6000; i++) {
  const day = Math.floor(rand() ** 0.8 * 730)
  const d = new Date(start.getTime() + day * 86400000)
  const category = pick(Object.keys(products), [4, 3, 3, 2])
  const [product, price] = pick(products[category])
  const units = 1 + Math.floor(rand() ** 2 * 4)
  const discount = pick([0, 0, 0, 0.1, 0.2])
  const revenue = Math.round(units * price * (1 - discount) * 100) / 100
  orders.push({
    order_id: `O-${100000 + i}`,
    order_date: iso(d),
    region: pick(['North America', 'Europe', 'APAC', 'LATAM'], [5, 4, 3, 1]),
    channel: pick(['Web', 'Mobile app', 'Marketplace', 'Retail'], [5, 3, 2, 1]),
    customer_segment: pick(['Consumer', 'SMB', 'Enterprise'], [6, 3, 1]),
    category,
    product,
    units,
    discount,
    revenue,
    cost: Math.round(revenue * (0.45 + rand() * 0.25) * 100) / 100,
    returned: rand() < 0.06,
  })
}
orders.sort((a, b) => a.order_date.localeCompare(b.order_date))
writeFileSync(join(here, 'orders.csv'), toCsv(orders))

// subscriptions: monthly SaaS metrics by plan and country
const subs = []
const plans = { Starter: 29, Team: 99, Business: 399, Enterprise: 1500 }
const countries = ['US', 'UK', 'Germany', 'France', 'Brazil', 'India', 'Japan']
const customers = {}
for (let m = 0; m < 24; m++) {
  const month = iso(new Date(Date.UTC(2024, 11 + m, 1)))
  for (const [plan, price] of Object.entries(plans)) {
    for (const country of countries) {
      const key = `${plan}|${country}`
      const prev = customers[key] ?? Math.floor(5 + rand() * 60 * (plan === 'Enterprise' ? 0.1 : 1))
      const newCustomers = Math.floor(rand() * (plan === 'Enterprise' ? 3 : 14))
      const churned = Math.floor(prev * (0.01 + rand() * 0.05))
      const now = Math.max(0, prev + newCustomers - churned)
      customers[key] = now
      subs.push({
        month,
        plan,
        country,
        customers: now,
        new_customers: newCustomers,
        churned_customers: churned,
        mrr: now * price,
        new_mrr: newCustomers * price,
        churned_mrr: churned * price,
        nps: Math.round(20 + rand() * 50),
      })
    }
  }
}
writeFileSync(join(here, 'subscriptions.csv'), toCsv(subs))
console.log(`orders: ${orders.length} rows, subscriptions: ${subs.length} rows`)
