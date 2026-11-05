module View.EncryptedRoomSetup exposing (Props, view)

{-| Room encryption setup and membership-rotation controls. Secret material is
deliberately absent: the private runtime owns keys, signed commits, and wraps.
-}

import Html exposing (Html, button, div, h2, input, label, p, section, text)
import Html.Attributes exposing (checked, class, disabled, type_)
import Html.Events exposing (onClick)


type alias Props msg =
    { room : String
    , status : String
    , membershipChanged : Bool
    , epoch : Maybe Int
    , verifiedDeviceCount : Int
    , backupReady : Bool
    , backupConfirmed : Bool
    , busy : Bool
    , onPlan : msg
    , onBackupConfirmation : Bool -> msg
    , onCommit : msg
    , onCancel : msg
    }


view : Props msg -> Html msg
view props =
    section [ class "encrypted-room-setup", Html.Attributes.attribute "aria-label" "Encrypted room setup" ]
        [ h2 [] [ text "Room encryption and device membership" ]
        , p [] [ text props.room ]
        , p [] [ text props.status ]
        , p [] [ text ("Current epoch: " ++ Maybe.withDefault "not installed" (Maybe.map String.fromInt props.epoch)) ]
        , p [] [ text (String.fromInt props.verifiedDeviceCount ++ " verified devices in the proposed membership.") ]
        , if props.membershipChanged then p [ class "warning" ] [ text "Membership or device trust changed. New room messages are paused until the matching commit and welcome are verified." ] else text ""
        , p [] [ text (if props.backupReady then "Encrypted recovery backup is ready." else "A password-protected recovery backup is required before this change can be sent.") ]
        , label []
            [ input [ type_ "checkbox", checked props.backupConfirmed, disabled props.busy || not props.backupReady, onClick (props.onBackupConfirmation (not props.backupConfirmed)) ] []
            , text "I reviewed the recovery backup and want to rotate this room epoch."
            ]
        , div [ class "encrypted-room-setup-actions" ]
            [ button [ onClick props.onPlan, disabled props.busy ] [ text "Review verified membership" ]
            , button [ onClick props.onCommit, disabled (props.busy || not props.backupReady || not props.backupConfirmed || props.verifiedDeviceCount <= 0) ] [ text "Commit and send device welcomes" ]
            , button [ onClick props.onCancel, disabled (not props.busy) ] [ text "Cancel or review delivery" ]
            ]
        ]
