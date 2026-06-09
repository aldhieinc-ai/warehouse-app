import { useEffect, useState, useRef } from 'react'
import { supabase } from './lib/supabase'
import { Html5QrcodeScanner, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { QRCodeCanvas } from 'qrcode.react'
import Barcode from 'react-barcode'
import { createRoot } from 'react-dom/client'
import * as XLSX from 'xlsx'

// J&T Express Brand Colors
const JT_RED = '#e31a1a'
const JT_WHITE = '#ffffff'
const JT_LIGHT_RED = '#fff5f5'

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
  const [isScanning, setIsScanning] = useState(false)
  const [scannerType, setScannerType] = useState(null) // 'global' or 'add-item'
  const [recentActivity, setRecentActivity] = useState([])
  const [importStats, setImportStats] = useState(null)
  
  // New states for Shipment Lookup
  const [senderParcels, setSenderParcels] = useState(null)
  const [viewingSender, setViewingSender] = useState('')

  // UI State
  const [isItemsExpanded, setIsItemsExpanded] = useState(false)
  
  const itemInputRef = useRef(null)
  const undoTimerRef = useRef(null)
  const scannerRef = useRef(null)
  const lastScannedRef = useRef({ value: '', time: 0 })
  const fileInputRef = useRef(null)

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
      .select(`
        *,
        bag_items (count)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    const bagsWithCounts = data.map(bag => ({
      ...bag,
      item_count: bag.bag_items[0]?.count || 0
    }))

    setBags(bagsWithCounts)
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
    await loadBags()
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
      addActivity('Error: Buka karung terlebih dahulu')
      return
    }

    const code = (codeToUse || itemCode).trim()
    if (!code) {
      addActivity('Error: Masukkan ID barang')
      return
    }

    const isDuplicate = bagItems.some(i => i.item_id === code)
    if (isDuplicate) {
      addActivity(`Sudah ada di karung saat ini: ${code}`)
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

    addActivity(`Ditambahkan: ${code}`)
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
    addActivity(`Menghapus ${rows.length} barang`)

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      setShowUndo(false)
    }, 10000)

    if (searchText.trim()) {
      await searchItems()
    }
    if (selectedBag) {
      await loadBagItems(selectedBag.id)
    } else {
      await loadBags()
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

    addActivity(`Membatalkan penghapusan ${lastRemoved.length} barang`)
    setLastRemoved([])
    setShowUndo(false)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)

    if (searchText.trim()) {
      await searchItems()
    }
    if (selectedBag) {
      await loadBagItems(selectedBag.id)
    } else {
      await loadBags()
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

    // 1. Existing Warehouse Search
    const { data: links, error: linksError } = await supabase
      .from('bag_items')
      .select('*')
      .in('item_id', itemIds)

    if (linksError) {
      addActivity(`Error: ${linksError.message}`)
      return
    }

    // 2. New Shipment Lookup
    const { data: shipmentsData, error: shipError } = await supabase
      .from('shipments')
      .select('*')
      .in('tracking_id', itemIds)

    if (shipError) {
      addActivity(`Error: ${shipError.message}`)
      return
    }

    // 3. Fetch Senders for those shipments
    const senderNames = [...new Set(shipmentsData.map(s => s.sender_name))]
    let sendersData = []
    if (senderNames.length > 0) {
      const { data } = await supabase
        .from('senders')
        .select('*')
        .in('sender_name', senderNames)
      sendersData = data || []
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

      const bag = link ? bagsData.find(
        b => b.id === link.bag_id
      ) : null

      const shipment = shipmentsData.find(s => s.tracking_id === itemId)
      let sender = null
      if (shipment) {
        sender = sendersData.find(s => s.sender_name === shipment.sender_name)
      }

      return {
        item_id: itemId,
        bag,
        shipment: shipment ? {
          ...shipment,
          sender_phone: sender?.phone
        } : null
      }
    })

    setSearchResults(results)
  }

  async function viewSenderParcels(senderName) {
    setViewingSender(senderName)
    
    // 1. Find all shipments for this sender
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('tracking_id')
      .eq('sender_name', senderName)
    
    if (error) {
      addActivity(`Error: ${error.message}`)
      return
    }
    
    const trackingIds = shipments.map(s => s.tracking_id)
    
    // 2. Find which ones are in bags
    const { data: links } = await supabase
      .from('bag_items')
      .select('item_id, bag_id')
      .in('item_id', trackingIds)
    
    const bagIds = [...new Set(links.map(l => l.bag_id))]
    let bagsData = []
    if (bagIds.length > 0) {
      const { data } = await supabase
        .from('bags')
        .select('id, bag_code')
        .in('id', bagIds)
      bagsData = data || []
    }
    
    const parcels = trackingIds.map(tid => {
      const link = links.find(l => l.item_id === tid)
      const bag = link ? bagsData.find(b => b.id === link.bag_id) : null
      return {
        tracking_id: tid,
        bag_code: bag ? bag.bag_code : 'NOT IN BAG'
      }
    })
    
    setSenderParcels(parcels)
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

    const qrRoot = printWindow.document.getElementById('qr-code')
    const barcodeRoot = printWindow.document.getElementById('barcode')

    if (qrRoot && barcodeRoot) {
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
      
      setTimeout(() => {
        printWindow.print()
        printWindow.close()
      }, 500)
    }
  }

  const startScanner = (type = 'global') => {
    setScannerType(type)
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

        if (type === 'add-item') {
          // Inside Karung Aktif - Always add to bag
          await addItemToBag(decodedText)
        } else {
          // Global Scan - Never add to bag
          if (decodedText.startsWith('BAG-')) {
            await openBagByCode(decodedText)
          } else {
            addActivity(`Cari: ${decodedText}`)
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
    setScannerType(null)
  }

  // Shipment Import Logic
  function isValidPhone(phone) {
    if (!phone) return false
    const s = String(phone).toLowerCase()
    if (s.includes('*') || s.includes('x')) return false
    const digits = s.replace(/\D/g, '')
    return digits.length >= 8
  }

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet)

      let importedShipments = 0
      let newSenders = 0
      let updatedPhones = 0
      let skippedRows = 0

      console.log(`Starting import of ${jsonData.length} rows...`)

      for (const row of jsonData) {
        const trackingId = row['No. Waybill']
        const senderName = row['Nama Pengirim']
        const senderPhone = row['HP Pengirim']
        const recipientName = row['Nama Penerima']

        // Skip row if tracking_id or sender_name is empty
        if (!trackingId || !senderName) {
          console.log(`Skipping row: Missing trackingId or senderName`)
          skippedRows++
          continue
        }

        try {
          // 1. Check existing sender (BUG FIX: Use maybeSingle)
          const { data: existingSender } = await supabase
            .from('senders')
            .select('phone')
            .eq('sender_name', senderName)
            .maybeSingle()

          const validPhone = isValidPhone(senderPhone) ? String(senderPhone) : null

          if (!existingSender) {
            // New sender: save with phone if valid
            await supabase.from('senders').insert({
              sender_name: senderName,
              phone: validPhone
            })
            console.log(`Sender created: ${senderName}`)
            newSenders++
          } else if (validPhone && !existingSender.phone) {
            // Existing sender with NULL phone: update with valid phone
            await supabase.from('senders').update({
              phone: validPhone,
              updated_at: new Date().toISOString()
            }).eq('sender_name', senderName)
            console.log(`Phone updated for: ${senderName}`)
            updatedPhones++
          } else {
            // Note: If sender already has a phone, we keep existing value as per requirements.
          }

          // 2. Upsert shipment (This is for lookup only, NO inventory creation)
          const { error: shipError } = await supabase
            .from('shipments')
            .upsert({
              tracking_id: String(trackingId),
              sender_name: senderName,
              recipient_name: recipientName ? String(recipientName) : null
            })

          if (shipError) {
            console.error(`Shipment error for ${trackingId}:`, shipError)
            skippedRows++
          } else {
            console.log(`Shipment imported: ${trackingId}`)
            importedShipments++
          }
        } catch (err) {
          console.error(`Unexpected error for ${trackingId}:`, err)
          skippedRows++
        }
      }

      setImportStats({ 
        imported: importedShipments, 
        newSenders: newSenders,
        updatedPhones: updatedPhones,
        skipped: skippedRows 
      })
      addActivity(`Impor Selesai: ${importedShipments} data kiriman`)
      console.log(`Import Complete: Shipments: ${importedShipments}, New Senders: ${newSenders}, Updated Phones: ${updatedPhones}, Skipped: ${skippedRows}`)
      e.target.value = null // Reset input
    }
    reader.readAsArrayBuffer(file)
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

  const buttonStyle = {
    padding: '10px 20px',
    backgroundColor: JT_RED,
    color: JT_WHITE,
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 'bold',
    transition: 'opacity 0.2s'
  }

  const secondaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#6c757d'
  }

  const cardStyle = {
    padding: '15px',
    backgroundColor: JT_WHITE,
    border: `1px solid #dee2e6`,
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    marginBottom: '20px'
  }

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto', backgroundColor: '#fdfdfd', minHeight: '100vh' }}>
      
      {/* Header with Logo */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <img 
          src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663698114786/KWpQrPdQFZsxLHLR.jpg" 
          alt="J&T Express Talang" 
          style={{ maxWidth: '250px', height: 'auto' }} 
        />
        <h1 style={{ color: JT_RED, marginTop: '10px', fontSize: '1.2rem', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Warehouse Management System
        </h1>
      </div>

      {/* TOP ACTION BAR */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <button 
          onClick={createBag}
          style={{ ...buttonStyle, backgroundColor: '#28a745' }}
        >
          Buat Karung
        </button>
        
        {!isScanning ? (
          <button 
            onClick={() => startScanner('global')}
            style={buttonStyle}
          >
            Scan
          </button>
        ) : (
          <button 
            onClick={stopScanner}
            style={{ ...buttonStyle, backgroundColor: '#dc3545' }}
          >
            Close Scanner
          </button>
        )}

        <button 
          onClick={() => fileInputRef.current.click()}
          style={{ ...buttonStyle, backgroundColor: '#007bff' }}
        >
          Impor Data
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".xlsx" 
          onChange={handleImport} 
        />
      </div>

      {/* ACTIVE BAG SECTION */}
      {selectedBag && (
        <div style={{ 
          ...cardStyle,
          borderLeft: `5px solid ${JT_RED}`,
          backgroundColor: JT_LIGHT_RED
        }}>
          <h2 style={{ marginTop: 0, color: JT_RED, fontSize: '1.1rem' }}>Karung Aktif</h2>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#333', marginBottom: '10px' }}>
            {selectedBag.bag_code}
          </div>
          <div style={{ marginBottom: '15px', color: '#666' }}>
            Jumlah Barang: <strong style={{ color: JT_RED }}>{bagItems.length}</strong>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
            <input
              ref={itemInputRef}
              type="text"
              placeholder="Item ID"
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItemToBag()}
              style={{ flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '1rem' }}
            />
            <button 
              onClick={() => addItemToBag()}
              style={{ ...buttonStyle, padding: '0 25px' }}
            >
              Tambah
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {!isScanning ? (
              <button 
                onClick={() => startScanner('add-item')}
                style={{ ...buttonStyle, backgroundColor: JT_RED }}
              >
                Tambah via Scan
              </button>
            ) : (
              <button 
                onClick={stopScanner}
                style={{ ...buttonStyle, backgroundColor: '#dc3545' }}
              >
                Tutup Scanner
              </button>
            )}
            <button 
              onClick={() => printBag(selectedBag)}
              style={{ ...buttonStyle, backgroundColor: '#6c757d' }}
            >
              Cetak
            </button>
            <button 
              onClick={() => setSelectedBag(null)}
              style={{ ...buttonStyle, backgroundColor: '#333' }}
            >
              Tutup Karung
            </button>
          </div>

          {/* Collapsible Item List */}
          <div style={{ borderTop: '1px solid #eee', paddingTop: '10px' }}>
            <button 
              onClick={() => setIsItemsExpanded(!isItemsExpanded)}
              style={{ 
                width: '100%', 
                textAlign: 'left', 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer',
                fontWeight: 'bold',
                color: '#555',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              {isItemsExpanded ? '▼' : '▶'} Daftar Barang ({bagItems.length})
            </button>
            
            {isItemsExpanded && (
              <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '10px' }}>
                {sortedBagItems.map(item => {
                  const highlighted = highlightItems.includes(item.item_id)
                  return (
                    <div key={item.item_id} style={{
                      padding: '8px 10px',
                      marginBottom: '4px',
                      backgroundColor: highlighted ? '#fff9c4' : 'rgba(255,255,255,0.5)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderRadius: '4px',
                      borderBottom: '1px solid #f0f0f0'
                    }}>
                      <span style={{ fontWeight: highlighted ? 'bold' : 'normal', fontSize: '0.9rem' }}>
                        {highlighted && '⭐ '} {item.item_id}
                      </span>
                      <button 
                        onClick={() => removeItem(item.item_id)}
                        style={{ padding: '2px 8px', backgroundColor: 'transparent', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#666' }}
                      >
                        Hapus
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {importStats && (
        <div style={{ 
          padding: '12px', 
          backgroundColor: '#e3f2fd', 
          border: '1px solid #90caf9', 
          borderRadius: '4px', 
          marginBottom: '20px'
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#007bff' }}>Impor Selesai</div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', fontSize: '0.9rem' }}>
            <div>Data Kiriman: <strong>{importStats.imported}</strong></div>
            <div>Pengirim Baru: <strong>{importStats.newSenders}</strong></div>
            <div>Telepon Diperbarui: <strong>{importStats.updatedPhones}</strong></div>
            <div>Dilewati: <strong style={{ color: JT_RED }}>{importStats.skipped}</strong></div>
            <button 
              onClick={() => setImportStats(null)}
              style={{ border: 'none', background: 'none', color: '#007bff', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {isScanning && (
        <div style={{ width: '100%', marginBottom: '20px', border: `2px solid ${JT_RED}`, borderRadius: '8px', overflow: 'hidden' }}>
          <div id="reader" style={{ width: '100%' }}></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', flexDirection: window.innerWidth < 600 ? 'column' : 'row' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ color: JT_RED, fontSize: '1.1rem' }}>Pencarian</h2>
          <textarea
            rows={4}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Scan atau ketik ID barang (satu per baris)"
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          <button
            onClick={() => searchItems()}
            style={{ ...buttonStyle, marginTop: 8, width: '100%' }}
          >
            Cari
          </button>

          {searchResults.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 style={{ fontSize: '1rem' }}>Hasil</h3>
              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
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
                  Pilih Semua yang Ditemukan
                </label>
              </div>

              {searchResults.map(result => (
                <div key={result.item_id} style={{
                  padding: '15px',
                  marginBottom: '10px',
                  backgroundColor: result.bag ? '#e8f5e9' : '#fff5f5',
                  border: `1px solid ${result.bag ? '#c8e6c9' : '#ffcdd2'}`,
                  borderRadius: '8px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: result.shipment ? '10px' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                        />
                      )}
                      <strong>{result.item_id}</strong>
                      <span style={{ color: '#666' }}>→</span>
                      {result.bag ? 
                        <span style={{ fontWeight: 'bold', color: '#2e7d32' }}>{result.bag.bag_code}</span> : 
                        <span style={{ color: JT_RED, fontWeight: 'bold' }}>TIDAK ADA DI GUDANG</span>
                      }
                    </div>
                    {result.bag && (
                      <button 
                        onClick={() => { setHighlightItems([result.item_id]); openBag(result.bag); }}
                        style={{ padding: '4px 10px', backgroundColor: JT_WHITE, border: `1px solid ${JT_RED}`, color: JT_RED, borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                      >
                        Buka
                      </button>
                    )}
                  </div>

                  {/* Shipment Lookup Information */}
                  {result.shipment ? (
                    <div style={{ 
                      marginTop: '10px', 
                      paddingTop: '10px', 
                      borderTop: '1px dashed #ccc',
                      fontSize: '0.9rem',
                      color: '#333'
                    }}>
                      <div style={{ marginBottom: '4px' }}>
                        <span style={{ color: '#666' }}>Pengirim:</span> <strong>{result.shipment.sender_name}</strong>
                      </div>
                      {result.shipment.sender_phone && (
                        <div style={{ marginBottom: '4px' }}>
                          <span style={{ color: '#666' }}>Telepon:</span> <strong>{result.shipment.sender_phone}</strong>
                        </div>
                      )}
                      <div style={{ marginBottom: '8px' }}>
                        <span style={{ color: '#666' }}>Penerima:</span> <strong>{result.shipment.recipient_name || '-'}</strong>
                      </div>
                      
                      {/* Case C specific reason */}
                      {!result.bag && (
                        <div style={{ 
                          fontSize: '0.8rem', 
                          color: '#666', 
                          fontStyle: 'italic',
                          marginBottom: '10px',
                          padding: '6px',
                          backgroundColor: 'rgba(0,0,0,0.03)',
                          borderRadius: '4px'
                        }}>
                          Alasan: Paket ada dalam catatan pengiriman tetapi saat ini tidak dimasukkan ke dalam karung gudang.
                        </div>
                      )}

                      <button 
                        onClick={() => viewSenderParcels(result.shipment.sender_name)}
                        style={{ 
                          padding: '6px 12px', 
                          backgroundColor: '#f8f9fa', 
                          border: '1px solid #ddd', 
                          borderRadius: '4px', 
                          cursor: 'pointer', 
                          fontSize: '0.8rem',
                          fontWeight: 'bold',
                          color: '#555'
                        }}
                      >
                        Lihat Paket Pengirim
                      </button>
                    </div>
                  ) : (
                    result.bag && (
                      <div style={{ 
                        marginTop: '10px', 
                        paddingTop: '10px', 
                        borderTop: '1px dashed #ccc',
                        fontSize: '0.8rem',
                        color: '#666',
                        fontStyle: 'italic'
                      }}>
                        Data kiriman tidak tersedia
                      </div>
                    )
                  )}
                </div>
              ))}

              <div style={{ marginTop: 10 }}>
                <button
                  onClick={removeSelectedItems}
                  disabled={selectedResults.length === 0}
                  style={{ ...buttonStyle, width: '100%', opacity: selectedResults.length === 0 ? 0.5 : 1 }}
                >
                  Hapus Terpilih ({selectedResults.length})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recent Activity Panel */}
        <div style={{ flex: 1, minWidth: '250px' }}>
          <h2 style={{ color: JT_RED, fontSize: '1.1rem' }}>Aktivitas Terbaru</h2>
          <div style={{ 
            height: '300px', 
            overflowY: 'auto', 
            border: '1px solid #eee', 
            padding: '10px',
            backgroundColor: JT_WHITE,
            borderRadius: '4px',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)'
          }}>
            {recentActivity.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', marginTop: '50px' }}>Tidak ada aktivitas terbaru</div>
            ) : (
              recentActivity.map(act => (
                <div key={act.id} style={{ fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid #f9f9f9' }}>
                  <span style={{ color: '#aaa', fontSize: '0.75rem' }}>[{act.time}]</span> {act.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Sender Parcels Modal-like Section */}
      {senderParcels && (
        <div style={{
          marginTop: '30px',
          padding: '20px',
          backgroundColor: '#fff',
          border: `2px solid #ddd`,
          borderRadius: '12px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ margin: 0, color: '#333', fontSize: '1.2rem' }}>{viewingSender}</h2>
            <button 
              onClick={() => setSenderParcels(null)}
              style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#999' }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '300px', overflowY: 'auto', padding: '5px' }}>
            {senderParcels.map(p => (
              <div key={p.tracking_id} style={{
                padding: '10px',
                border: '1px solid #eee',
                borderRadius: '6px',
                backgroundColor: '#fdfdfd'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{p.tracking_id}</div>
                <div style={{ 
                  fontSize: '0.85rem', 
                  color: p.bag_code === 'NOT IN BAG' ? JT_RED : '#2e7d32',
                  fontWeight: 'bold',
                  marginTop: '4px'
                }}>
                  {p.bag_code === 'NOT IN BAG' ? 'TIDAK DALAM KARUNG' : p.bag_code}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BAG LIST */}
      <h2 style={{ color: JT_RED, fontSize: '1.1rem', marginTop: '30px' }}>Daftar Karung</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '15px' }}>
        {bags.map((bag) => (
          <div key={bag.id} style={{
            ...cardStyle,
            marginBottom: 0,
            borderTop: selectedBag?.id === bag.id ? `4px solid ${JT_RED}` : '1px solid #dee2e6',
            backgroundColor: selectedBag?.id === bag.id ? JT_LIGHT_RED : JT_WHITE
          }}>
            <strong style={{ fontSize: '1rem' }}>{bag.bag_code}</strong>
            <div style={{ color: '#666', fontSize: '0.9rem', marginTop: '4px' }}>
              Jumlah Barang: <span style={{ color: JT_RED, fontWeight: 'bold' }}>{bag.item_count}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button 
                onClick={() => openBag(bag)}
                style={{ flex: 1, padding: '6px', backgroundColor: JT_WHITE, border: `1px solid ${JT_RED}`, color: JT_RED, borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Buka
              </button>
              <button 
                onClick={() => printBag(bag)}
                style={{ flex: 1, padding: '6px', backgroundColor: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Cetak
              </button>
            </div>
          </div>
        ))}
      </div>

      {showUndo && lastRemoved.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)', 
          background: '#333', color: '#fff', padding: '15px 25px', borderRadius: '50px', 
          zIndex: 1000, boxShadow: '0 8px 25px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: '20px', minWidth: '300px', justifyContent: 'center'
        }}>
          <span style={{ fontWeight: 'bold' }}>Menghapus {lastRemoved.length} barang</span>
          <button onClick={undoRemove} style={{
            padding: '6px 20px', backgroundColor: JT_RED, color: '#fff', border: 'none',
            borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.8rem'
          }}>Batalkan</button>
        </div>
      )}
    </div>
  )
}
