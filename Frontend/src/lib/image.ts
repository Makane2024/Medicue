// Shrinks a picked image to a small JPEG data URL. Profile photos are stored on the profile row and sent with
// every doctor listing, so the backend only accepts about 100 KB; a 256 px JPEG is typically 15-30 KB.
export function shrinkImage(file: File, maxSide = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Could not process the image'))
      ctx.fillStyle = '#fff' // JPEG has no transparency
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a readable image'))
    }
    img.src = url
  })
}
