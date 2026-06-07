import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { QRCodeCanvas } from 'qrcode.react'
import Barcode from 'react-barcode'
import { createRoot } from 'react-dom/client'

export default function App() {
  const [bags, setBags] = useState([])
  const [selectedBag, setSelectedBag] = useState(null)
  const [bagItems, setBagItems] = useState([])
  const [itemCode, setItemCode] = useState('')
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [highlightItems, setHighlightItems] = useState([])
  const [selectedResults, setSelectedResults] = useState([])
  const [lastRemoved, setLastRemoved] = useState([])
  const [showUndo, setShowUndo] = useState(false)
  const [scanItemMode, setScanItemMode] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [recentActivity, setRecentActivity] = useState([])
  
  const itemInputRef = useRef(null)
  const undoTimerRef = useRef(null)
  const scannerRef = useRef(null)
  const lastScannedRef = useRef({ value: '', time: 0 })

  useEffect(() => {
    loadBags()
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.error('Failed to clear scanner', err))
      }
    }
  }, [])

  function addActivity(text) {
    setRecentActivity(prev => [{
      id: Date.now(),
      text,
      time: new Date().toLocaleTimeString()
    }, ...prev].slice(0, 20))
  }

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
      addActivity(`Error: ${error.message}`)
      return
    }

    addActivity(`Created bag: ${bagCode}`)
    await loadBags()
  }

  async function openBag(bag) {
    setSelectedBag(bag)
    await loadBagItems(bag.id)
    addActivity(`Opened bag: ${bag.bag_code}`)
  }

  async function openBagByCode(bagCode) {
    const { data, error } = await supabase
      .from('bags')
      .select('*')
      .eq('bag_code', bagCode)
      .single()

    if (error || !data) {
      addActivity(`Bag ${bagCode} not found`)
      return
    }

    setSelectedBag(data)
    await loadBagItems(data.id)
    addActivity(`Opened bag: ${data.bag_code}`)
  }

  async function addItemToBag(codeToUse) {
    const targetBag = selectedBag
    if (!targetBag) {
      addActivity('Error: Open a bag first')
      return
    }

    const code = (codeToUse || itemCode).trim()
    if (!code) {
      addActivity('Error: Enter item ID')
      return
    }

    // Duplicate check in current bag
    const isDuplicate = bagItems.some(i => i.item_id === code)
    if (isDuplicate) {
      addActivity(`Already in current bag: ${code}`)
      setItemCode('')
      return
    }

    const { error: itemError } = await supabase
      .from('items')
      .upsert({
        item_id: code
      })

    if (itemError) {
      addActivity(`Error: ${itemError.message}`)
      return
    }

    const { error: bagItemError } = await supabase
      .from('bag_items')
      .insert({
        item_id: code,
        bag_id: targetBag.id
      })

    if (bagItemError) {
      addActivity(`Error: ${bagItemError.message}`)
      return
    }

    addActivity(`Added: ${code}`)
    setItemCode('')
    await loadBagItems(targetBag.id)

    if (itemInputRef.current) {
      itemInputRef.current.focus()
    }
  }

  async function deleteBagItems(rows) {
    if (rows.length === 0) return

    const { error } = await supabase
      .from('bag_items')
      .delete()
      .in('item_id', rows.map(r => r.item_id))

    if (error) {
      addActivity(`Error: ${error.message}`)
      return
    }

    setLastRemoved(rows)
    setShowUndo(true)
    addActivity(`Removed ${rows.length} item(s)`)

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      setShowUndo(false)
    }, 10000)

    if (searchText.trim()) {
      await searchItems()
    }
    if (selectedBag) {
      await loadBagItems(selectedBag.id)
    }
  }

  async function removeItem(itemId) {
    const item = bagItems.find(i => i.item_id === itemId)
    if (!item) return

    await deleteBagItems([{
      item_id: item.item_id,
      bag_id: item.bag_id
    }])
  }

  async function removeSelectedItems() {
    const rows = searchResults
      .filter(r => selectedResults.includes(r.item_id) && r.bag)
      .map(r => ({
        item_id: r.item_id,
        bag_id: r.bag.id
      }))

    if (rows.length === 0) return

    await deleteBagItems(rows)
    setSelectedResults([])
  }

  async function undoRemove() {
    if (lastRemoved.length === 0) return

    const { error } = await supabase
      .from('bag_items')
      .insert(lastRemoved)

    if (error) {
      addActivity(`Error: ${error.message}`)
      return
    }

    addActivity(`Undid removal of ${lastRemoved.length} item(s)`)
    setLastRemoved([])
    setShowUndo(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)

    if (searchText.trim()) {
      await searchItems()
    }
    if (selectedBag) {
      await loadBagItems(selectedBag.id)
    }
  }

  async function searchItems(textToUse) {
    const currentSearchText = textToUse !== undefined ? textToUse : searchText
    const itemIds = currentSearchText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    if (itemIds.length === 0) {
      setSearchResults([])
      return
    }

    const { data: links, error } = await supabase
      .from('bag_items')
      .select('*')
      .in('item_id', itemIds)

    if (error) {
      addActivity(`Error: ${error.message}`)
      return
    }

    const bagIds = [
      ...new Set(
        links.map(x => x.bag_id)
      )
    ]

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
      addActivity('Error: Please allow popups')
      return
    }

    const createdDate = new Date(bag.created_at).toLocaleString('en-GB', {
      timeZone: 'Asia/Jakarta'
    })

    // Prepare the print document structure
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Bag: ${bag.bag_code}</title>
        <style>
          @page { margin: 0; }
          body { 
            font-family: Arial, sans-serif; 
            margin: 0; 
            padding: 10px;
            width: 80mm;
            box-sizing: border-box;
            text-align: center;
          }
          .label-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
          }
          .bag-code { font-size: 24pt; font-weight: bold; margin-bottom: 5px; }
          .date { font-size: 10pt; margin-bottom: 15px; }
          .qr-container { margin-bottom: 15px; }
          .barcode-container { margin-bottom: 10px; }
          .footer-code { font-size: 14pt; margin-top: 5px; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div id="print-root" class="label-container">
          <div class="bag-code">${bag.bag_code}</div>
          <div class="date">${createdDate} WIB</div>
          <div id="qr-code" class="qr-container"></div>
          <div id="barcode" class="barcode-container"></div>
          <div class="footer-code">${bag.bag_code}</div>
        </div>
      </body>
      </html>
    `)

    // We need to render the barcodes into the new window's DOM
    const qrRoot = printWindow.document.getElementById('qr-code')
    const barcodeRoot = printWindow.document.getElementById('barcode')

    if (qrRoot && barcodeRoot) {
      // Use React to render components into the print window's containers
      const qrReactRoot = createRoot(qrRoot)
      qrReactRoot.render(<QRCodeCanvas value={bag.bag_code} size={150} />)

      const barcodeReactRoot = createRoot(barcodeRoot)
      barcodeReactRoot.render(
        <Barcode 
          value={bag.bag_code} 
          format="CODE128" 
          width={2} 
          height={60} 
          displayValue={false} 
          margin={0}
        />
      )
      
      // Give it a small delay to ensure rendering before printing
      setTimeout(() => {
        printWindow.print()
        printWindow.close()
      }, 500)
    }
  }

  const startScanner = () => {
    setIsScanning(true)
    setTimeout(() => {
      const scanner = new Html5QrcodeScanner('reader', {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8
        ]
      })

      scanner.render(async (decodedText) => {
        const now = Date.now()
        if (decodedText === lastScannedRef.current.value && now - lastScannedRef.current.time < 2000) {
          return
        }
        lastScannedRef.current = { value: decodedText, time: now }

        if (decodedText.startsWith('BAG-')) {
          await openBagByCode(decodedText)
        } else {
          if (scanItemMode) {
            await addItemToBag(decodedText)
          } else {
            addActivity(`Search: ${decodedText}`)
            setSearchText(decodedText)
            await searchItems(decodedText)
          }
        }
      }, (error) => {
        // Handle scan error (silent)
      })
      
      scannerRef.current = scanner
    }, 100)
  }

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.clear()
        scannerRef.current = null
      } catch (err) {
        console.error('Failed to clear scanner', err)
      }
    }
    setIsScanning(false)
  }

  const sortedBagItems = [
    ...bagItems.filter(item =>
      highlightItems.includes(item.item_id)
    ),
    ...bagItems.filter(
      item =>
        !highlightItems.includes(item.item_id)
    )
  ]

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Warehouse</h1>

      {/* Current Bag Panel */}
      <div style={{ 
        padding: '15px', 
        backgroundColor: '#f8f9fa', 
        border: '1px solid #dee2e6', 
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h2 style={{ marginTop: 0 }}>Current Bag</h2>
        {selectedBag ? (
          <div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#007bff' }}>
              {selectedBag.bag_code}
            </div>
            <div style={{ marginTop: '5px' }}>
              Items: <strong>{bagItems.length}</strong>
            </div>
          </div>
        ) : (
          <div style={{ color: '#6c757d', fontStyle: 'italic' }}>None Selected</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button 
          onClick={createBag}
          style={{ padding: '10px 20px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Create Bag
        </button>
        
        {!isScanning ? (
          <button 
            onClick={startScanner}
            style={{ padding: '10px 20px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Scan
          </button>
        ) : (
          <button 
            onClick={stopScanner}
            style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Close Scanner
          </button>
        )}

        {selectedBag && (
          !scanItemMode ? (
            <button 
              onClick={() => setScanItemMode(true)}
              style={{ padding: '10px 20px', backgroundColor: '#ffc107', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Start Scan Item Mode
            </button>
          ) : (
            <button 
              onClick={() => setScanItemMode(false)}
              style={{ padding: '10px 20px', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Stop Scan Item Mode
            </button>
          )
        )}
      </div>

      {scanItemMode && (
        <div style={{ 
          padding: '10px', 
          backgroundColor: '#fff3cd', 
          border: '1px solid #ffeeba', 
          borderRadius: '4px', 
          marginBottom: '20px',
          fontWeight: 'bold',
          textAlign: 'center',
          color: '#856404'
        }}>
          ⚠️ SCAN ITEM MODE ACTIVE
        </div>
      )}

      {isScanning && (
        <div style={{ width: '100%', marginBottom: '20px', border: '2px solid #007bff', borderRadius: '8px', overflow: 'hidden' }}>
          <div id="reader" style={{ width: '100%' }}></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flexDirection: window.innerWidth < 600 ? 'column' : 'row' }}>
        <div style={{ flex: 1 }}>
          <h2>Batch Search</h2>
          <textarea
            rows={4}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Scan or type item IDs (one per line)"
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
          />
          <button
            onClick={() => searchItems()}
            style={{ marginTop: 8, width: '100%', padding: '10px' }}
          >
            Search
          </button>

          {searchResults.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3>Results</h3>
              <div style={{ marginBottom: 10 }}>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      searchResults.filter(r => r.bag).length > 0 &&
                      selectedResults.length === searchResults.filter(r => r.bag).length
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedResults(searchResults.filter(r => r.bag).map(r => r.item_id))
                      } else {
                        setSelectedResults([])
                      }
                    }}
                  />
                  {' '} Select All Found
                </label>
              </div>

              {searchResults.map(result => (
                <div key={result.item_id} style={{
                  padding: '8px',
                  marginBottom: '4px',
                  backgroundColor: result.bag ? '#e8f5e9' : '#ffebee',
                  border: '1px solid #ccc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    {result.bag && (
                      <input
                        type="checkbox"
                        checked={selectedResults.includes(result.item_id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedResults([...selectedResults, result.item_id])
                          } else {
                            setSelectedResults(selectedResults.filter(x => x !== result.item_id))
                          }
                        }}
                        style={{ marginRight: 8 }}
                      />
                    )}
                    <strong>{result.item_id}</strong>
                    {' → '}
                    {result.bag ? result.bag.bag_code : <span style={{ color: 'red', fontWeight: 'bold' }}>NOT FOUND</span>}
                  </div>
                  {result.bag && (
                    <button onClick={() => {
                      setHighlightItems([result.item_id])
                      openBag(result.bag)
                    }}>Open</button>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={removeSelectedItems}
                  disabled={selectedResults.length === 0}
                  style={{ width: '100%', padding: '10px' }}
                >
                  Remove Selected ({selectedResults.length})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recent Activity Panel */}
        <div style={{ flex: 1, minWidth: '250px' }}>
          <h2>Recent Activity</h2>
          <div style={{ 
            height: '300px', 
            overflowY: 'auto', 
            border: '1px solid #ccc', 
            padding: '10px',
            backgroundColor: '#fff',
            borderRadius: '4px'
          }}>
            {recentActivity.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', marginTop: '50px' }}>No recent activity</div>
            ) : (
              recentActivity.map(act => (
                <div key={act.id} style={{ fontSize: '0.9rem', padding: '5px 0', borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#999', fontSize: '0.8rem' }}>[{act.time}]</span> {act.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <h2>Bags</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
        {bags.map((bag) => (
          <div key={bag.id} style={{
            padding: '12px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: selectedBag?.id === bag.id ? '#e7f3ff' : '#fff'
          }}>
            <strong>{bag.bag_code}</strong>
            <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
              <button onClick={() => { setHighlightItems([]); openBag(bag); }}>Open</button>
              <button onClick={() => printBag(bag)}>Print</button>
            </div>
          </div>
        ))}
      </div>

      {selectedBag && (
        <div style={{ marginTop: 30, padding: 16, border: '2px solid #333', borderRadius: '8px' }}>
          <h2>Bag: {selectedBag.bag_code}</h2>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
            <input
              ref={itemInputRef}
              type="text"
              placeholder="Item ID"
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItemToBag()}
              style={{ flex: 1, padding: '8px' }}
            />
            <button onClick={() => addItemToBag()}>Add Item</button>
          </div>

          <h3>Items ({bagItems.length})</h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {sortedBagItems.map(item => {
              const highlighted = highlightItems.includes(item.item_id)
              return (
                <div key={item.item_id} style={{
                  padding: '8px',
                  marginBottom: '4px',
                  backgroundColor: highlighted ? '#fff3cd' : 'transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #eee'
                }}>
                  <span>{highlighted && '⭐ '} {item.item_id}</span>
                  <button onClick={() => removeItem(item.item_id)}>Remove</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {showUndo && lastRemoved.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, background: '#333', color: '#fff',
          padding: '12px 20px', borderRadius: '8px', zIndex: 1000, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: '15px'
        }}>
          <span>Removed {lastRemoved.length} item(s)</span>
          <button onClick={undoRemove} style={{
            padding: '5px 12px', backgroundColor: '#fff', color: '#333', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
          }}>Undo</button>
        </div>
      )}
    </div>
  )
}
