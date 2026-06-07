import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function App() {
  const [bags, setBags] = useState([])
  const [selectedBag, setSelectedBag] = useState(null)
  const [bagItems, setBagItems] = useState([])
  const [itemCode, setItemCode] = useState('')

  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState([])

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

  async function searchItems() {
    const itemIds = searchText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    if (itemIds.length === 0) {
      alert('Enter at least one item ID')
      return
    }

    const { data: links, error } = await supabase
      .from('bag_items')
      .select('*')
      .in('item_id', itemIds)

    if (error) {
      alert(error.message)
      return
    }

    const bagIds = [...new Set(
      links.map(x => x.bag_id)
    )]

    let bagsData = []

    if (bagIds.length > 0) {
      const { data } = await supabase
        .from('bags')
        .select('*')
        .in('id', bagIds)

      bagsData = data || []
    }

    const results = itemIds.map(itemId => {
      const link = links.find(
        x => x.item_id === itemId
      )

      if (!link) {
        return {
          item_id: itemId,
          bag: null
        }
      }

      const bag = bagsData.find(
        b => b.id === link.bag_id
      )

      return {
        item_id: itemId,
        bag
      }
    })

    setSearchResults(results)
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
      </head>
      <body style="font-family:Arial;text-align:center;padding:20px;">
        <div style="border:1px solid black;padding:20px;display:inline-block;">
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

      <h2>Batch Search</h2>

      <textarea
        rows={6}
        value={searchText}
        onChange={(e) =>
          setSearchText(e.target.value)
        }
        style={{
          width: '100%',
          maxWidth: '500px'
        }}
      />

      <br />

      <button
        onClick={searchItems}
        style={{ marginTop: 8 }}
      >
        Search
      </button>

      {searchResults.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Results</h3>

          {searchResults.map(result => (
            <div
              key={result.item_id}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid #ddd'
              }}
            >
              <strong>
                {result.item_id}
              </strong>

              {' → '}

              {result.bag ? (
                <>
                  {result.bag.bag_code}

                  <button
                    onClick={() =>
                      openBag(result.bag)
                    }
                    style={{
                      marginLeft: 8
                    }}
                  >
                    Open
                  </button>
                </>
              ) : (
                'NOT FOUND'
              )}
            </div>
          ))}
        </div>
      )}

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
            marginTop: 30,
            padding: 16,
            border: '2px solid #333'
          }}
        >
          <h2>
            Bag: {selectedBag.bag_code}
          </h2>

          <input
            type="text"
            placeholder="Item ID"
            value={itemCode}
            onChange={(e) =>
              setItemCode(e.target.value)
            }
            style={{
              width: '300px',
              padding: '8px'
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

          <h3>
            Items ({bagItems.length})
          </h3>

          {bagItems.map(item => (
            <div key={item.item_id}>
              {item.item_id}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
