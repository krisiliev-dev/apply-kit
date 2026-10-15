// Text recognition for scanned PDFs, on this laptop (macOS Vision). Renders each page and prints
// {"pages":[{"lines":[...]}]} as JSON, lines top to bottom. Nothing leaves the machine.
import AppKit
import Foundation
import PDFKit
import Vision

guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
  FileHandle.standardError.write("Not a PDF\n".data(using: .utf8)!)
  exit(2)
}
var pages: [[String: [String]]] = []
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let image = page.thumbnail(of: CGSize(width: bounds.width * 3, height: bounds.height * 3), for: .mediaBox)
  guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  let supported = (try? request.supportedRecognitionLanguages()) ?? []
  let wanted = ["en-US", "bg-BG", "ru-RU"].filter { supported.contains($0) }
  if !wanted.isEmpty { request.recognitionLanguages = wanted }
  try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
  let found = (request.results ?? []).sorted { $0.boundingBox.minY > $1.boundingBox.minY }
  pages.append(["lines": found.compactMap { $0.topCandidates(1).first?.string }])
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: ["pages": pages]))
