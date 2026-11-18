* SAPMV45A	Dynamic Enhancement Point/Section	\PR:SAPMV45A\FO:USEREXIT_DELETE_DOCUMENT

ENHANCEMENT 1  ZOTC_EI_SO_DELETION_IDOC.    "active version
*
**********************************************************************
* Program Name      : USEREXIT_DELETE_DOCUMENT
* Title             : Enhancement for sending IDOC when SO is deleted
* Created by        : Rakesh Gadiparthi
* Created on        : 06/02/2026
* RICEF ID          :
* Release           : R2B
**********************************************************************
* Purpose           : Sending IDOC to Bluejay and Newcold when SO is deleted
***********************************************************************

*" Check if the document is being deleted (Standard check for VA02 'Delete' action)
*
    CONSTANTS : lc_cond  TYPE zde_condition VALUE 'SO',
                lc_vstat TYPE nast-vstat VALUE '1'.

    TYPES : BEGIN OF ty_nast,
              objky  TYPE nast-objky,
              kschl  TYPE nast-kschl,
              cmfpnr TYPE nast-cmfpnr,
              vstat  TYPE nast-vstat,
            END OF ty_nast.


      DATA lv_indicator TYPE edi_vtdl18 VALUE '003'.
      DATA lv_vbeln TYPE vbak-vbeln.

      DATA : lt_selection  TYPE TABLE OF rsparams,
             lwa_selection TYPE rsparams.

      EXPORT lv_indicator TO MEMORY ID 'ZSO_DEL'.
      SELECT * FROM zscm_util_940 INTO TABLE lt_util_940
        WHERE zcondition EQ lc_cond.
      IF sy-subrc EQ 0.

        SELECT objky kschl cmfpnr vstat
          FROM nast INTO TABLE lt_nast_940
          FOR ALL ENTRIES IN lt_util_940
          WHERE objky EQ vbak-vbeln
            AND kschl EQ lt_util_940-kschl
            AND vstat EQ lc_vstat.
        IF sy-subrc EQ 0.
          DELETE ADJACENT DUPLICATES FROM lt_nast_940 COMPARING kschl.


          LOOP AT lt_nast_940 INTO DATA(ls_940).



            CLEAR lwa_selection.

            lwa_selection-selname = 'S_KAPPL'.
            lwa_selection-kind    = 'S'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = 'V1'.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'S_OBJKY'.
            lwa_selection-kind    = 'S'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = vbak-vbeln.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'S_KSCHL'.
            lwa_selection-kind    = 'S'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = ls_940-kschl.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'S_NACHA'.
            lwa_selection-kind    = 'S'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = '6'.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'P_MODE'.
            lwa_selection-kind    = 'P'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = '2'.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'P_DIALOG'.
            lwa_selection-kind    = 'P'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = space.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'P_GRID'.
            lwa_selection-kind    = 'P'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = space.
            APPEND lwa_selection TO lt_selection.

            lwa_selection-selname = 'P_PRINT'.
            lwa_selection-kind    = 'P'.
            lwa_selection-sign    = 'I'.
            lwa_selection-option  = 'EQ'.
            lwa_selection-low     = space.
            APPEND lwa_selection TO lt_selection.
          ENDLOOP.


          lv_vbeln = vbak-vbeln.

          CALL FUNCTION 'DEQUEUE_EVVBAKE'
            EXPORTING
              vbeln = lv_vbeln.

          SUBMIT rsnast0d WITH SELECTION-TABLE lt_selection
                          AND RETURN.
          FREE MEMORY ID 'ZSO_DEL'.
        ENDIF.
      ENDIF.
    ENDIF.

ENDENHANCEMENT.
