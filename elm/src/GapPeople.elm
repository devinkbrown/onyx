module GapPeople exposing (Msg(..))

{-| v3/gap-people — the slice's messages, wrapped by `App.GapPeopleMsg`
so the shared `Msg` union gains one constructor.

  - `RosterShowMore group` — paint the next window of a roster group.
  - `StewardInvite room` — Room care's Invite (closes Room care, opens
    the invite sheet).
  - `StewardAskLeave` / `StewardCancelLeave` / `StewardConfirmLeave room`
    — Room care's Leave with its confirm step.
  - `TranscriptExport format` — Room settings' local transcript export
    (`"txt"` or `"json"`).

-}


type Msg
    = RosterShowMore String
    | StewardInvite String
    | StewardAskLeave
    | StewardCancelLeave
    | StewardConfirmLeave String
    | TranscriptExport String
