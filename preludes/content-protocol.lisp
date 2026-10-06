; content-protocol.lisp
; -----------------------------------------------------------------------------
; Hosted ContentProtocol protocol descriptors.
; -----------------------------------------------------------------------------

(type ContentText
  {:kind "text"
   :value String})

(type ContentMarkdown
  {:kind "md"
   :content String})

(type ContentCode
  {:kind "code"
   :content String})

(type ContentH1
  {:kind "h1"
   :children (List ContentNode)})

(type ContentH2
  {:kind "h2"
   :children (List ContentNode)})

(type ContentH3
  {:kind "h3"
   :children (List ContentNode)})

(type ContentParagraph
  {:kind "p"
   :children (List ContentNode)})

(type ContentUnorderedList
  {:kind "ul"
   :children (List ContentNode)})

(type ContentOrderedList
  {:kind "ol"
   :children (List ContentNode)})

(type ContentListItem
  {:kind "li"
   :children (List ContentNode)})

(type ContentBold
  {:kind "bold"
   :children (List ContentNode)})

(type ContentItalic
  {:kind "italic"
   :children (List ContentNode)})

(type ContentLink
  {:kind "link"
   :href String
   :children (List ContentNode)})

(type ContentDoc
  {:kind "doc"
   :children (List ContentNode)})

(type ContentNode
  (Union ContentText ContentMarkdown ContentCode ContentH1 ContentH2 ContentH3 ContentParagraph ContentUnorderedList ContentOrderedList ContentListItem ContentBold ContentItalic ContentLink ContentDoc))

(define protocol {:name "ContentProtocol"})
