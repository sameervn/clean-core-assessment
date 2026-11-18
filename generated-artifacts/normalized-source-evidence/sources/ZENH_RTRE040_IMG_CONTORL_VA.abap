* /OPT/CL_V_VA2_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET----ZENH_RTRE040_IMG_CONTORL_VA.
   IF sy-tcode EQ '/OPT/VIM_VA2'.
      SELECT SINGLE
      lifnr,
      bukrs,
      begru
      FROM lfb1
      WHERE lifnr EQ @ls_doc_hdr-lifnr
      AND   bukrs EQ @ls_doc_hdr-bukrs
      INTO @DATA(lwa_lfb1).
      IF sy-subrc EQ 0 AND  lwa_lfb1-begru IS NOT INITIAL.
        AUTHORITY-CHECK OBJECT 'Z_6NX_AP'
        ID 'ACTION' FIELD 'A'.
        IF sy-subrc <> 0.
          CLEAR : mv_archiv_id , mv_arc_doc_id.
        ENDIF.
      ENDIF.
    ENDIF.
