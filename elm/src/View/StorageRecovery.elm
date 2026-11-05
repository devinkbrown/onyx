module View.StorageRecovery exposing (Item, Props, view)

import Html exposing (Html, button, div, h2, input, label, li, p, section, text, ul)
import Html.Attributes exposing (checked, class, disabled, type_, value)
import Html.Events exposing (onClick, onInput)
import Set exposing (Set)


type alias Item =
    { recordId : String
    , source : String
    , safeSummary : String
    , admitted : Bool
    }


type alias Props msg =
    { items : List Item
    , selected : Set String
    , mappingTarget : String
    , busy : Bool
    , storageStatus : String
    , quotaMessage : String
    , draftStatus : String
    , evictionPreviewCount : Int
    , onSelect : String -> msg
    , onMappingTarget : String -> msg
    , onReview : msg
    , onRecover : msg
    , onDiscard : msg
    , onExportSelected : msg
    , onPreviewEviction : msg
    , onApplyEviction : msg
    }


view : Props msg -> Html msg
view props =
    section [ class "storage-recovery", Html.Attributes.attribute "aria-label" "Local storage recovery" ]
        [ h2 [] [ text "Local storage and recovery" ]
        , p [] [ text ("Storage: " ++ props.storageStatus) ]
        , p [] [ text props.draftStatus ]
        , p [] [ text props.quotaMessage ]
        , p [] [ text (String.fromInt (List.length props.items) ++ " unclassified local items are available for review.") ]
        , ul [] (List.map (itemView props) props.items)
        , label []
            [ text "Conversation for selected history rows"
            , input [ type_ "text", value props.mappingTarget, onInput props.onMappingTarget, disabled props.busy ] []
            ]
        , div [ class "storage-recovery-actions" ]
            [ button [ onClick props.onReview, disabled props.busy ] [ text "Review selected" ]
            , button [ onClick props.onRecover, disabled (props.busy || Set.isEmpty props.selected || String.isEmpty props.mappingTarget) ] [ text "Recover selected" ]
            , button [ onClick props.onDiscard, disabled (props.busy || Set.isEmpty props.selected) ] [ text "Discard selected" ]
            , button [ onClick props.onExportSelected, disabled (props.busy || Set.isEmpty props.selected) ] [ text "Export selected history" ]
            , button [ onClick props.onPreviewEviction, disabled props.busy ] [ text "Preview history cleanup" ]
            , button [ onClick props.onApplyEviction, disabled (props.busy || props.evictionPreviewCount <= 0) ] [ text ("Remove " ++ String.fromInt props.evictionPreviewCount ++ " selected old rows") ]
            ]
        ]


itemView : Props msg -> Item -> Html msg
itemView props item =
    li [ class "storage-recovery-item" ]
        [ label []
            [ input [ type_ "checkbox", checked (Set.member item.recordId props.selected), onClick (props.onSelect item.recordId), disabled props.busy ] []
            , text (item.source ++ " — " ++ item.safeSummary ++ (if item.admitted then " (delivery outcome uncertain; cannot be resent)" else ""))
            ]
        ]
