import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function App() {
  const [bags, setBags] = useState([])
  const [selectedBag, setSelectedBag] = useState(null)
  const [bagItems, setBagItems] = useState([])
  const [itemCode, setItemCode] = useState('')

  useEffect(() => {
    loadBags()
  }, [])

  async function loadBags() {
    const { data, error } = await supabase
      .from('bags')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setBags(data)
  }

  async function loadBagItems(bagId) {
    const { data, error } = await supabase
      .from('bag_items')
      .select('*')
      .eq('bag_id', bagId)
      .order('added_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setBagItems(data || [])
  }

  function generateBagCode() {
    const now = new Date()

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now)

    const get = (type) =>
      parts.find((p) => p.type === type)?.value

    return `BAG-${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`
  }

  async function createBag() {
    const bagCode = generateBagCode()

    const { error } = await supabase
      .from('bags')
      .insert({
        bag_code: bagCode
      })

    if (error) {
      alert(error.message)
      return
    }

    await loadBags()
  }

  async function openBag(bag) {
    setSelectedBag(bag)
    await loadBagItems(bag.id)
  }

  async function addItemToBag() {
    if (!selectedBag) {
      alert('Open a bag first')
      return
    }

    if (!itemCode.trim()) {
      alert('Enter item ID')
      return
    }

    const code = itemCode.trim()

    const { error: itemError } = await supabase
      .from('items')
      .upsert({
        item_id: code
      })

    if (itemError) {
      alert(itemError.message)
      return
    }

    const { error: bagItemError } = await supabase
      .from('bag_items')
      .insert({
        item_id: code,
        bag_id: selectedBag.id
      })

    if (bagItemError) {
      alert(bagItemError.message)
      return
    }

    setItemCode('')
    await loadBagItems(selectedBag.id)
  }

  function printBag(bag) {
    const printWindow = window.open('', '_blank')

    if (!printWindow) {
      alert('Please allow popups')
      return
    }

    const createdDate = new Date(
      bag.created_at
    ).toLocaleString('en-GB', {
      timeZone: 'Asia/Jakarta'
    })

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${bag.bag_code}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
          }

          .label {
            border: 1px solid #000;
            padding: 20px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="label">
          <h2>${bag.bag_code}</h2>

          <p>
            Created:<br>
            ${createdDate} WIB
          </p>
        </div>
      </body>
      </html>
    `)

    printWindow.document.close()
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Warehouse</h1>

      <button onClick={createBag}>
        Create Bag
      </button>

      <h2>Bags</h2>

      {bags.map((bag) => (
        <div
          key={bag.id}
          style={{
            padding: '12px',
            marginBottom: '8px',
            border: '1px solid #ccc'
          }}
        >
          <div>
            <strong>{bag.bag_code}</strong>
          </div>

          <div style={{ marginTop: '8px' }}>
            <button
              onClick={() => openBag(bag)}
              style={{ marginRight: '8px' }}
            >
              Open
            </button>

            <button
              onClick={() => printBag(bag)}
            >
              Print
            </button>
          </div>
        </div>
      ))}

      {selectedBag && (
        <div
          style={{
            marginTop: '30px',
            padding: '16px',
            border: '2px solid #333'
          }}
        >
          <h2>
            Bag: {selectedBag.bag_code}
          </h2>

          <div>
            <input
              type="text"
              placeholder="Item ID"
              value={itemCode}
              onChange={(e) =>
                setItemCode(e.target.value)
              }
              style={{
                padding: '8px',
                width: '300px'
              }}
            />

            <button
              onClick={addItemToBag}
              style={{
                marginLeft: '8px'
              }}
            >
              Add Item
            </button>
          </div>

          <h3>
            Items ({bagItems.length})
          </h3>

          {bagItems.map((item) => (
            <div
              key={item.item_id}
              style={{
                padding: '4px 0'
              }}
            >
              {item.item_id}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
